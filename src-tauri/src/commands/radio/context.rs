//! 送判上下文渲染：来源标签（明文/匿名两版）、同会话近期上下文行——
//! feishu 轮询与收音机重判/强制捕捉共用的 prompt 语境构造。
use chrono::TimeZone;
use rusqlite::{params, Connection};

/// AI prompt 里的来源标签：告诉模型消息来自哪种会话、谁在说话
pub(crate) fn chat_label(chat_type: &str, chat_name: &str) -> String {
    match chat_type {
        "bot" => "飞书·机器人私聊".into(),
        "p2p" => format!("飞书·私聊「{chat_name}」"),
        "group" => format!("飞书·群聊「{chat_name}」"),
        "local" => "手动输入·快速捕捉".into(),
        _ => {
            if chat_name.is_empty() {
                "飞书".into()
            } else {
                format!("飞书「{chat_name}」")
            }
        }
    }
}

/// AI prompt 来源标签的匿名版：群名换成稳定代号（群_xxxx）、单聊对方名过人名词表
/// scrub——真名/真群名不进 prompt（display 场景仍用上面的 chat_label）。
/// 群代号分配失败（老库无表等）降级为不带名的「飞书·群聊」
pub(crate) fn chat_label_anon(
    conn: &Connection,
    rules: &mut crate::anonymize::AnonRules,
    chat_id: &str,
    chat_type: &str,
    chat_name: &str,
) -> String {
    match chat_type {
        "group" => match rules.chat_alias_of(conn, chat_id, chat_name) {
            Some(alias) => format!("飞书·群聊「{alias}」"),
            None => "飞书·群聊".into(),
        },
        // 单聊对方名过人名词表 scrub（词表未覆盖的名字是已知边界）
        "p2p" => format!("飞书·私聊「{}」", rules.scrub(chat_name)),
        // 机器人私聊/快速捕捉是常量标签；兜底形态带名时同样 scrub
        "bot" | "local" => chat_label(chat_type, chat_name),
        _ => {
            if chat_name.is_empty() {
                "飞书".into()
            } else {
                format!("飞书「{}」", rules.scrub(chat_name))
            }
        }
    }
}

/// 一条上下文消息的原料（未格式化）：匿名化由调用方持规则包完成
#[derive(Debug, Clone)]
pub(crate) struct ContextLine {
    pub time: String,
    pub sender_id: String,
    pub is_self: bool,
    /// 用户可见版（真名）
    pub content: String,
    /// 匿名版（老数据空串，格式化时现场 scrub）
    pub content_anon: String,
}

/// 同会话近期上下文（发送时间在 [sent_at - window, sent_at) 内的最近 max 条）。
/// 返回未匿名化的原料行，经 format_context_lines 格式化为 "[HH:MM] 发送者: 内容"。
pub(crate) fn chat_context_lines(
    conn: &Connection,
    chat_id: &str,
    sent_at: i64,
    exclude_message_id: &str,
    window_ms: i64,
    max_messages: i64,
) -> Vec<ContextLine> {
    if chat_id.is_empty() || sent_at <= 0 {
        return vec![];
    }
    let mut stmt = match conn.prepare(
        "SELECT sender_id, is_self, content, content_anon, sent_at FROM chat_messages
         WHERE chat_id=?1 AND sent_at IS NOT NULL AND sent_at >= ?2 AND sent_at < ?3 AND message_id != ?4
         ORDER BY sent_at DESC LIMIT ?5",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows: Vec<(String, i64, String, String, i64)> = match stmt.query_map(
        params![
            chat_id,
            sent_at - window_ms,
            sent_at,
            exclude_message_id,
            max_messages
        ],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    ) {
        Ok(rows) => rows.flatten().collect(),
        Err(_) => return vec![],
    };
    rows.into_iter()
        .rev() // 查询取最近 N 条的倒序，还原为时间升序
        .map(
            |(sender_id, is_self, content, content_anon, at)| ContextLine {
                time: chrono::Local
                    .timestamp_millis_opt(at)
                    .single()
                    .map(|t| t.format("%H:%M").to_string())
                    .unwrap_or_default(),
                sender_id,
                is_self: is_self != 0,
                content,
                content_anon,
            },
        )
        .collect()
}

/// 上下文行的匿名化格式化：发送者用代号（自己标注「我」），内容用匿名版
/// （老数据无匿名列时现场 scrub 真名版兜底），真名不进 prompt。
pub(crate) fn format_context_lines(
    conn: &Connection,
    rules: &mut crate::anonymize::AnonRules,
    lines: Vec<ContextLine>,
) -> Vec<String> {
    lines
        .into_iter()
        .map(|l| {
            let who = if l.is_self {
                crate::anonymize::ME.to_string()
            } else if l.sender_id.is_empty() {
                // 老数据缺 sender_id：宁丢发送者信息也不泄真名
                "成员".to_string()
            } else {
                rules.alias_of(conn, &l.sender_id)
            };
            let text = if l.content_anon.is_empty() {
                rules.scrub(&l.content)
            } else {
                l.content_anon
            };
            let clipped: String = text.chars().take(200).collect();
            format!("[{}] {who}: {clipped}", l.time)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::radio::testsupport::*;
    use crate::db::Db;
    use tauri::Manager;

    /// 上下文窗口：同会话、时间在 [t-30min, t) 的消息按时间升序，
    /// 自己发的标注「我」；之后的/超窗的/别的会话的都不算。
    /// 匿名化格式化后：他人 sender 用代号、老数据无匿名版现场 scrub，真名不进 prompt
    #[test]
    fn chat_context_lines_picks_recent_same_chat_only() {
        let app = setup();
        let t = 1_789_200_000_000i64;
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let ins = |mid: &str, chat: &str, sender: &str, sid: &str, is_self: i64, at: i64| {
                conn.execute(
                    "INSERT INTO chat_messages (message_id, chat_id, chat_name, chat_type, sender, sender_id, content, sent_at, is_self, ai_status, review_status, created_at)
                     VALUES (?1, ?2, '项目群', 'group', ?3, ?4, '内容', ?5, ?6, 'skipped', 'pending', '2026-09-12T00:00:00Z')",
                    params![mid, chat, sender, sid, at, is_self],
                )
                .unwrap();
            };
            ins("om_me", "oc_g", "我的显示名", "ou_me", 1, t - 60_000);
            ins("om_other", "oc_g", "李四", "ou_li", 0, t - 30_000);
            ins("om_after", "oc_g", "李四", "ou_li", 0, t + 10_000);
            ins("om_stale", "oc_g", "李四", "ou_li", 0, t - 40 * 60_000);
            ins("om_else", "oc_h", "李四", "ou_li", 0, t - 10_000);
            conn.execute(
                "INSERT INTO feishu_users (open_id, name, alias, updated_at)
                 VALUES ('ou_li', '李四', '成员_00dd', '2026-09-01')",
                [],
            )
            .unwrap();
        }
        let (lines, formatted) = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let mut rules = crate::anonymize::AnonRules::build(&conn);
            let lines = chat_context_lines(&conn, "oc_g", t, "om_target", 30 * 60 * 1000, 10);
            let formatted = format_context_lines(&conn, &mut rules, lines.clone());
            (lines, formatted)
        };
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert!(lines[0].is_self, "时间升序：第一条是我");
        assert!(
            formatted[0].contains("我: 内容"),
            "自己标注为「我」: {formatted:?}"
        );
        assert!(
            !formatted[0].contains("我的显示名"),
            "不暴露原始显示名以免与「我」混淆: {formatted:?}"
        );
        assert!(
            formatted[1].contains("成员_00dd: 内容"),
            "他人 sender 用代号: {formatted:?}"
        );
        assert!(
            !formatted[1].contains("李四"),
            "上下文行真名不进 prompt: {formatted:?}"
        );
        // 空会话 / 老数据（无 sent_at）安全退化为空
        let empty = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            chat_context_lines(&conn, "", t, "om_target", 30 * 60 * 1000, 10)
        };
        assert!(empty.is_empty());
    }

    #[test]
    fn chat_label_variants() {
        assert_eq!(chat_label("bot", "皮卡丘助手"), "飞书·机器人私聊");
        assert_eq!(chat_label("p2p", "李四"), "飞书·私聊「李四」");
        assert_eq!(chat_label("group", "项目群"), "飞书·群聊「项目群」");
        assert_eq!(chat_label("", ""), "飞书");
    }

    /// 匿名版来源标签：群名 → 稳定代号、单聊对方名过词表、真名/真群名不进 prompt
    #[test]
    fn chat_label_anon_pseudonymizes_names() {
        let conn = crate::db::tests::test_conn();
        conn.execute(
            "INSERT INTO feishu_users (open_id, name, updated_at, alias)
             VALUES ('ou_z', '张三', '2026-09-01', '成员_00aa')",
            [],
        )
        .unwrap();
        let mut rules = crate::anonymize::AnonRules::build(&conn);
        // 群名换稳定代号，且两次调用同一代号
        let g1 = chat_label_anon(&conn, &mut rules, "oc_g", "group", "项目攻坚群");
        let g2 = chat_label_anon(&conn, &mut rules, "oc_g", "group", "项目攻坚群");
        assert_eq!(g1, g2);
        assert!(
            g1.starts_with("飞书·群聊「群_") && g1.ends_with("」"),
            "{g1}"
        );
        assert!(!g1.contains("项目攻坚群"), "真群名不出现: {g1}");
        // 单聊对方名在词表内 → 代号；不在词表的名字保持原样（词表边界）
        let p = chat_label_anon(&conn, &mut rules, "oc_p", "p2p", "张三");
        assert_eq!(p, "飞书·私聊「成员_00aa」");
        let unknown = chat_label_anon(&conn, &mut rules, "oc_p2", "p2p", "陌生人名X");
        assert_eq!(unknown, "飞书·私聊「陌生人名X」");
        // 常量标签不带入名字
        assert_eq!(
            chat_label_anon(&conn, &mut rules, "", "bot", "皮卡丘助手"),
            "飞书·机器人私聊"
        );
        assert_eq!(
            chat_label_anon(&conn, &mut rules, "", "local", ""),
            "手动输入·快速捕捉"
        );
    }
}
