//! 假名化（pseudonymization）：送大模型前把真实姓名与群聊名替换成稳定代号，
//! 判定落库前反向还原。隐私边界：真名只存在于本地库（chat_messages / feishu_users /
//! feishu_chat_aliases / settings），prompt 与 pk context 输出里只有代号与第一人称「我」。
//!
//! 代号锚定 open_id（`feishu_users.alias`，部分唯一索引）：由 open_id 哈希确定性生成，
//! 分配一次永不重算——跨批次、跨消息、跨 pk context 同一代号，模型才能维持
//! 「同代号 = 同一人」的指代（判重、跟进、人物标签都依赖）；哈希截短偶发碰撞由
//! 唯一索引拒绝，向后探测补位。群聊名同构（`feishu_chat_aliases`，群_xxxx）。

use rusqlite::{params, Connection};
use std::collections::HashMap;

/// 「我」的统一代称：@到我 与 我的称呼（pk context 的待办标题里）都渲染成它
pub const ME: &str = "我";
/// 手打文本命中称呼列表时的正文标记——区别于显式 @，模型按「疑似提及」处理
pub const ME_HINT: &str = "（疑似@我）";
/// 参与文本替换的最短词长：单字称呼（如单姓）误伤率过高，不进文本匹配
const MIN_NAME_LEN: usize = 2;

/// 懒分配并返回 open_id 的代号：已分配则原样复用；未分配则按哈希生成、
/// 唯一索引冲突向后探测。行不存在（@ 了群外成员）时先补行再分配。
pub fn ensure_alias(conn: &Connection, open_id: &str) -> Option<String> {
    if open_id.is_empty() {
        return None;
    }
    if let Some(alias) = existing_alias(conn, open_id) {
        return Some(alias);
    }
    let _ = conn.execute(
        "INSERT INTO feishu_users (open_id, name, updated_at) VALUES (?1, '', ?2)
         ON CONFLICT(open_id) DO NOTHING",
        params![open_id, crate::db::now()],
    );
    let base = alias_hash(open_id);
    for probe in 0..64u32 {
        let candidate = if probe == 0 {
            base.clone()
        } else {
            format!("{base}{probe:x}")
        };
        // 只写仍为空的行：并发下别人（应用/pk 另一进程）已分配则以库里的为准
        match conn.execute(
            "UPDATE feishu_users SET alias=?2 WHERE open_id=?1 AND (alias='' OR alias IS NULL)",
            params![open_id, candidate],
        ) {
            Ok(1) => return Some(candidate),
            // 候选被占用（唯一索引）或行被并发写入：前者继续探测，后者重查收敛
            _ => {
                if let Some(alias) = existing_alias(conn, open_id) {
                    return Some(alias);
                }
            }
        }
    }
    log::warn!("anonymize: 代号探测 64 次未收敛（open_id={open_id}），本轮退回短 id 展示");
    None
}

fn existing_alias(conn: &Connection, open_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT alias FROM feishu_users WHERE open_id=?1",
        params![open_id],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .filter(|a| !a.is_empty())
}

/// open_id → 「成员_xxxx」：DefaultHasher 在同一构建内确定（std 不承诺跨版本稳定，
/// 但已分配代号以库为准，哈希漂移只影响未分配的新 open_id，无一致性风险）
fn alias_hash(open_id: &str) -> String {
    chat_style_hash("成员", open_id)
}

/// 哈希截短 → 「前缀_xxxx」形态代号（成员/群共用）
fn chat_style_hash(prefix: &str, key: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    key.hash(&mut h);
    format!("{prefix}_{:04x}", h.finish() & 0xffff)
}

/// 懒分配并返回群聊代号（群_xxxx，锚定 chat_id）：已分配则复用并同步最新群名
/// （restore 还原展示用），未分配则按哈希生成、唯一索引冲突向后探测。
/// 行不存在时先补行再分配（与 ensure_alias 同构）
pub fn ensure_chat_alias(conn: &Connection, chat_id: &str, chat_name: &str) -> Option<String> {
    if chat_id.is_empty() {
        return None;
    }
    if let Some(alias) = existing_chat_alias(conn, chat_id) {
        if !chat_name.is_empty() {
            let _ = conn.execute(
                "UPDATE feishu_chat_aliases SET chat_name=?2 WHERE chat_id=?1 AND chat_name<>'' AND chat_name<>?2",
                params![chat_id, chat_name],
            );
        }
        return Some(alias);
    }
    let _ = conn.execute(
        "INSERT INTO feishu_chat_aliases (chat_id, chat_name) VALUES (?1, ?2)
         ON CONFLICT(chat_id) DO NOTHING",
        params![chat_id, chat_name],
    );
    let base = chat_style_hash("群", chat_id);
    for probe in 0..64u32 {
        let candidate = if probe == 0 {
            base.clone()
        } else {
            format!("{base}{probe:x}")
        };
        match conn.execute(
            "UPDATE feishu_chat_aliases SET alias=?2 WHERE chat_id=?1 AND (alias='' OR alias IS NULL)",
            params![chat_id, candidate],
        ) {
            Ok(1) => return Some(candidate),
            _ => {
                if let Some(alias) = existing_chat_alias(conn, chat_id) {
                    return Some(alias);
                }
            }
        }
    }
    log::warn!("anonymize: 群代号探测 64 次未收敛（chat_id={chat_id}），本轮来源不带群名");
    None
}

fn existing_chat_alias(conn: &Connection, chat_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT alias FROM feishu_chat_aliases WHERE chat_id=?1",
        params![chat_id],
        |r| r.get::<_, String>(0),
    )
    .ok()
    .filter(|a| !a.is_empty())
}

/// 一轮脱敏的规则包：构建时查一次库做快照，整批判定复用。
/// - `my_names`：我的称呼（settings 配置 ∪ 真名 ∪ 群内显示名），命中替换成 ME_HINT；
/// - `replacements`：其余成员「真名 → 代号」，长名优先防短名截胡；
/// - `same_name_risk`：通讯录缓存里存在与我的称呼同名（open_id ≠ 我）的成员，
///   提示模型对「疑似@我」的判定更谨慎。
pub struct AnonRules {
    my_open_id: String,
    my_names: Vec<String>,
    aliases: HashMap<String, String>,
    chat_aliases: HashMap<String, String>,
    replacements: Vec<(String, String)>,
    pub same_name_risk: bool,
}

impl AnonRules {
    pub fn build(conn: &Connection) -> Self {
        let setting = |k: &str| -> String {
            conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
                r.get::<_, String>(0)
            })
            .unwrap_or_default()
        };
        let my_open_id = setting("feishu_my_open_id");
        let mut my_names = parse_name_list(&setting("feishu_my_names"));
        let my_name = setting("feishu_my_name");
        if my_name.chars().count() >= MIN_NAME_LEN {
            my_names.push(my_name);
        }
        // 群内显示名（群昵称）随成员缓存自动跟上，不需要用户维护
        if let Ok(name) = conn.query_row(
            "SELECT name FROM feishu_users WHERE open_id=?1",
            params![&my_open_id],
            |r| r.get::<_, String>(0),
        ) {
            if name.chars().count() >= MIN_NAME_LEN {
                my_names.push(name);
            }
        }
        my_names.sort_by_key(|a| std::cmp::Reverse(a.chars().count()));
        my_names.dedup();

        let mut aliases = HashMap::new();
        let mut others: Vec<(String, String)> = vec![];
        let mut same_name_risk = false;
        if let Ok(mut stmt) = conn.prepare("SELECT open_id, name, alias FROM feishu_users") {
            if let Ok(rows) = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            }) {
                for (open_id, name, alias) in rows.flatten() {
                    let is_me = !my_open_id.is_empty() && open_id == my_open_id;
                    if name.chars().count() >= MIN_NAME_LEN && my_names.contains(&name) {
                        // 与我的称呼同名：我优先按「我」替换；他人条目不进词表，
                        // 由 same_name_risk 标注提醒模型存在歧义
                        if !is_me {
                            same_name_risk = true;
                        }
                        continue;
                    }
                    if is_me || name.is_empty() || alias.is_empty() {
                        continue;
                    }
                    aliases.insert(open_id.clone(), alias.clone());
                    others.push((name, alias));
                }
            }
        }
        // 长名优先：先替换更具体的称呼，防止「蔡乔蓉」被「乔蓉」拆走
        others.sort_by_key(|(n, _)| std::cmp::Reverse(n.chars().count()));
        let mut replacements: Vec<(String, String)> = my_names
            .iter()
            .map(|n| (n.clone(), ME_HINT.to_string()))
            .collect();
        replacements.extend(others);
        // 群聊代号快照（老库无表时为空映射，chat_alias_of 的懒分配自会补齐或降级）
        let chat_aliases = conn
            .prepare("SELECT chat_id, alias FROM feishu_chat_aliases WHERE alias != ''")
            .and_then(|mut stmt| {
                stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                    .map(|rows| rows.flatten().collect::<HashMap<_, _>>())
            })
            .unwrap_or_default();
        Self {
            my_open_id,
            my_names,
            aliases,
            chat_aliases,
            replacements,
            same_name_risk,
        }
    }

    /// open_id → 代号（我的 open_id → 「我」；未分配的懒分配并写库）
    pub fn alias_of(&mut self, conn: &Connection, open_id: &str) -> String {
        if !self.my_open_id.is_empty() && open_id == self.my_open_id {
            return ME.into();
        }
        if let Some(a) = self.aliases.get(open_id) {
            return a.clone();
        }
        let assigned =
            ensure_alias(conn, open_id).unwrap_or_else(|| open_id.chars().take(11).collect());
        self.aliases.insert(open_id.into(), assigned.clone());
        assigned
    }

    /// chat_id → 群代号（群_xxxx，未分配的懒分配并写库；chat_id 空或分配失败返回 None，
    /// 调用方降级为不带名的来源标签）
    pub fn chat_alias_of(
        &mut self,
        conn: &Connection,
        chat_id: &str,
        chat_name: &str,
    ) -> Option<String> {
        if let Some(a) = self.chat_aliases.get(chat_id) {
            return Some(a.clone());
        }
        let assigned = ensure_chat_alias(conn, chat_id, chat_name)?;
        self.chat_aliases.insert(chat_id.into(), assigned.clone());
        Some(assigned)
    }

    /// 只读版：渲染等不可变借用场景用。调用方需先 `alias_of` 预分配过本批 open_id，
    /// 未命中缓存时退回短 id 展示（防御路径，正常流程不出现）。
    pub fn alias_cached(&self, open_id: &str) -> String {
        if !self.my_open_id.is_empty() && open_id == self.my_open_id {
            return ME.into();
        }
        self.aliases
            .get(open_id)
            .cloned()
            .unwrap_or_else(|| open_id.chars().take(11).collect())
    }

    /// 文本脱敏（消息正文场景）：称呼/成员名 → ME_HINT / 代号。display 版不调用（恒等）。
    pub fn scrub(&self, text: &str) -> String {
        self.scrub_with(text, ME_HINT)
    }

    /// 文本脱敏（待办标题/标签场景）：我的称呼替换成第一人称「我」（标题里出现
    /// 「（疑似@我）」没有语义，这里不需要区分确定性）
    pub fn scrub_titles(&self, text: &str) -> String {
        self.scrub_with(text, ME)
    }

    fn scrub_with(&self, text: &str, my_replacement: &str) -> String {
        let mut out = text.to_string();
        for (name, rep) in &self.replacements {
            if out.contains(name.as_str()) {
                let target = if rep == ME_HINT { my_replacement } else { rep };
                out = out.replace(name.as_str(), target);
            }
        }
        out
    }

    /// 手打文本是否命中过我的称呼（正文出现 ME_HINT 即算疑似提及）
    pub fn hints_me(&self, text: &str) -> bool {
        text.contains(ME_HINT) && !self.my_names.is_empty()
    }
}

/// 代号 → 真名（pk 落库前还原用户可见文本）：只还原能查到真名的代号，
/// 查不到真名的保留原样（模型幻觉代号原样可见，也便于排查）。
/// 群代号（群_xxxx）同样还原——模型可能把来源代号写进新标签名
pub fn restore(conn: &Connection, text: &str) -> String {
    let mut pairs: Vec<(String, String)> = match conn
        .prepare(
            "SELECT alias, name FROM feishu_users WHERE alias != '' AND name != ''
             UNION ALL
             SELECT alias, chat_name FROM feishu_chat_aliases WHERE alias != '' AND chat_name != ''",
        )
        .and_then(|mut stmt| {
            stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map(|rows| rows.flatten().collect())
        }) {
        Ok(p) => p,
        Err(_) => return text.to_string(),
    };
    // 长代号优先：防止 群_a1 被前缀相同的更长代号截胡
    pairs.sort_by_key(|(a, _)| std::cmp::Reverse(a.chars().count()));
    let mut out = text.to_string();
    for (alias, name) in pairs {
        if out.contains(alias.as_str()) {
            out = out.replace(alias.as_str(), &name);
        }
    }
    out
}

/// 称呼列表存储格式：逗号/顿号分隔的明文（用户在设置页维护），解析后去空
pub fn parse_name_list(raw: &str) -> Vec<String> {
    raw.split([',', '，', '、'])
        .map(str::trim)
        .filter(|s| s.chars().count() >= MIN_NAME_LEN)
        .map(String::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_conn(&conn).unwrap();
        conn
    }

    fn seed_user(conn: &Connection, open_id: &str, name: &str) {
        conn.execute(
            "INSERT INTO feishu_users (open_id, name, updated_at) VALUES (?1, ?2, '2026-09-01')",
            params![open_id, name],
        )
        .unwrap();
    }

    fn set_setting(conn: &Connection, key: &str, value: &str) {
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value=?2",
            params![key, value],
        )
        .unwrap();
    }

    #[test]
    fn alias_is_stable_and_lazy_assigned() {
        let conn = db();
        seed_user(&conn, "ou_a", "张三");
        let a1 = ensure_alias(&conn, "ou_a").unwrap();
        let a2 = ensure_alias(&conn, "ou_a").unwrap();
        assert_eq!(a1, a2, "分配一次后必须稳定复用");
        assert!(a1.starts_with("成员_"), "代号形如 成员_xxxx: {a1}");

        // 群外成员（无缓存行）也能即时分配
        let b = ensure_alias(&conn, "ou_b").unwrap();
        assert_ne!(a1, b);
        let got: String = conn
            .query_row(
                "SELECT alias FROM feishu_users WHERE open_id='ou_b'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(got, b, "懒分配要落库，跨进程才能共用");
    }

    #[test]
    fn alias_collision_probes_forward() {
        let conn = db();
        // 预占第一个候选：对 ou_b 直接手写一个与 alias_hash 同式的代号
        let target = alias_hash("ou_b");
        seed_user(&conn, "ou_occupied", "占位");
        conn.execute(
            "UPDATE feishu_users SET alias=?1 WHERE open_id='ou_occupied'",
            params![target],
        )
        .unwrap();
        let b = ensure_alias(&conn, "ou_b").unwrap();
        assert_ne!(b, target, "候选被占时应向后探测: {b}");
    }

    #[test]
    fn scrub_replaces_my_names_first_and_others_by_length() {
        let conn = db();
        set_setting(&conn, "feishu_my_open_id", "ou_me");
        set_setting(&conn, "feishu_my_name", "蔡乔蓉");
        set_setting(&conn, "feishu_my_names", "乔蓉");
        seed_user(&conn, "ou_me", "蔡乔蓉");
        seed_user(&conn, "ou_z", "张三丰");
        seed_user(&conn, "ou_w", "张三");
        conn.execute(
            "UPDATE feishu_users SET alias='成员_00aa' WHERE open_id='ou_z'",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE feishu_users SET alias='成员_00bb' WHERE open_id='ou_w'",
            [],
        )
        .unwrap();
        let rules = AnonRules::build(&conn);

        // 我的称呼（含短称呼）→ 疑似@我；长名优先：张三丰不能被张三截胡
        let out = rules.scrub("乔蓉帮我看下，再找张三丰和张三对齐");
        assert_eq!(out, "（疑似@我）帮我看下，再找成员_00aa和成员_00bb对齐");

        assert!(rules.hints_me(&out));
        assert!(!rules.hints_me("只有成员_00aa，没有我"));
    }

    #[test]
    fn same_name_member_flags_risk_and_stays_out_of_replacements() {
        let conn = db();
        set_setting(&conn, "feishu_my_open_id", "ou_me");
        set_setting(&conn, "feishu_my_name", "蔡乔蓉");
        seed_user(&conn, "ou_me", "蔡乔蓉");
        seed_user(&conn, "ou_same", "蔡乔蓉"); // 同名同事
        seed_user(&conn, "ou_z", "李四");
        conn.execute(
            "UPDATE feishu_users SET alias='成员_00cc' WHERE open_id='ou_same'",
            [],
        )
        .unwrap();
        let rules = AnonRules::build(&conn);
        assert!(rules.same_name_risk, "存在同名成员要能检出");
        // 同名同事的代号不进词表：文本里的名字统一按「疑似@我」处理，由模型结合警示判断
        let out = rules.scrub("蔡乔蓉来对一下");
        assert_eq!(out, "（疑似@我）来对一下");
    }

    #[test]
    fn alias_of_maps_me_and_lazily_assigns_others() {
        let conn = db();
        set_setting(&conn, "feishu_my_open_id", "ou_me");
        let mut rules = AnonRules::build(&conn);
        assert_eq!(rules.alias_of(&conn, "ou_me"), "我");
        let a = rules.alias_of(&conn, "ou_new");
        let again = rules.alias_of(&conn, "ou_new");
        assert_eq!(a, again);
        assert!(a.starts_with("成员_"));
    }

    #[test]
    fn restore_maps_alias_back_to_real_name() {
        let conn = db();
        seed_user(&conn, "ou_z", "张三");
        conn.execute(
            "UPDATE feishu_users SET alias='成员_00aa' WHERE open_id='ou_z'",
            [],
        )
        .unwrap();
        let out = restore(&conn, "找成员_00aa对齐材料");
        assert_eq!(out, "找张三对齐材料");
        // 未知代号（模型幻觉/无真名）原样保留
        assert_eq!(restore(&conn, "找成员_ffff对齐"), "找成员_ffff对齐");
    }

    #[test]
    fn chat_alias_is_stable_lazy_and_restores() {
        let conn = db();
        let a1 = ensure_chat_alias(&conn, "oc_chat", "项目攻坚群").unwrap();
        let a2 = ensure_chat_alias(&conn, "oc_chat", "项目攻坚群（改名）").unwrap();
        assert_eq!(a1, a2, "分配一次后稳定复用");
        assert!(a1.starts_with("群_"), "代号形如 群_xxxx: {a1}");
        // 群名更新同步（restore 还原展示用）
        let name: String = conn
            .query_row(
                "SELECT chat_name FROM feishu_chat_aliases WHERE chat_id='oc_chat'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(name, "项目攻坚群（改名）");
        // 空 chat_id 不分配；AnonRules 走缓存
        assert!(ensure_chat_alias(&conn, "", "x").is_none());
        let mut rules = AnonRules::build(&conn);
        assert_eq!(rules.chat_alias_of(&conn, "oc_chat", ""), Some(a1.clone()));
        let other = rules.chat_alias_of(&conn, "oc_new", "新群").unwrap();
        assert!(other.starts_with("群_"));
        // restore：群代号还原成最新群名（模型把来源代号写进标签名的场景）
        let out = restore(&conn, &format!("按 {a1} 的安排推进"));
        assert_eq!(out, "按 项目攻坚群（改名） 的安排推进");
    }

    #[test]
    fn parse_name_list_splits_and_filters() {
        assert_eq!(
            parse_name_list("蔡乔蓉，乔蓉、小蔡 , 王"),
            vec!["蔡乔蓉".to_string(), "乔蓉".to_string(), "小蔡".to_string()]
        );
    }
}
