//! 飞书消息拉取与语境判定：用户身份与凭证由官方 lark-cli 保管（子进程封装见 lark_cli.rs），
//! 这里负责会话/消息的聚合翻页、谁的消息送 AI 的语境规则、入库与 AI 分发。
use crate::ai::{self, AiMessage};
use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::events;
use rusqlite::{params, Connection};
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// AI 判定附带的同会话上下文窗口：往前 30 分钟、最多 10 条
const CONTEXT_WINDOW_MS: i64 = 30 * 60 * 1000;
const CONTEXT_MAX_MESSAGES: i64 = 10;
/// 群成员名缓存刷新的翻页上限（单页 100，超出的大群发送者退化为短 id）
const MEMBERS_MAX_PAGES: u32 = 3;

// ---- lark-cli 之上的聚合翻页层（单页 API 封装见 lark_cli.rs） ----

/// 会话概要。chat_mode 区分 p2p（单聊）/ group（群聊），
/// p2p 项带对端类型/ID（types=p2p,group 才返回）
#[derive(Debug)]
struct ChatSummary {
    chat_id: String,
    name: String,
    chat_mode: String,
    /// p2p 会话的对端类型：Some("bot") = 与机器人的单聊（用户发的消息按备忘提取）
    p2p_target_type: Option<String>,
    /// p2p 会话的对端 open_id（等于本人即"发给自己的会话"）
    p2p_target_id: Option<String>,
}

/// 会话列表（含 p2p 单聊），逐页拉全（500 条上限防失控）
async fn chats(bin: &str) -> AppResult<Vec<ChatSummary>> {
    let mut out = vec![];
    let mut page_token: Option<String> = None;
    loop {
        let d = crate::lark_cli::list_chats(bin, 100, page_token.as_deref()).await?;
        for item in d["items"].as_array().cloned().unwrap_or_default() {
            let chat_id = item["chat_id"].as_str().unwrap_or_default().to_string();
            if chat_id.is_empty() {
                continue;
            }
            out.push(ChatSummary {
                chat_id,
                name: item["name"].as_str().unwrap_or("未命名会话").to_string(),
                chat_mode: item["chat_mode"].as_str().unwrap_or("group").to_string(),
                p2p_target_type: item["p2p_target_type"].as_str().map(String::from),
                p2p_target_id: item["p2p_target_id"].as_str().map(String::from),
            });
        }
        let has_more = d["has_more"].as_bool().unwrap_or(false);
        page_token = d["page_token"].as_str().map(String::from);
        if !has_more || page_token.is_none() || out.len() > 500 {
            break;
        }
    }
    Ok(out)
}

/// 批量查询会话免打扰状态的三值态（折叠状态开放平台未暴露，免打扰是最接近的可见信号，
/// 折叠的噪音会话通常也被设为免打扰）。归类规则：
/// ① 所在批次（10 会话/批）查询失败 → 该批全部 Unknown（降级不过滤，不阻断拉取）；
/// ② 批次成功但响应 items 缺某 chat_id → Unmuted（与旧行为等价：只有显式 is_muted=true 才算免打扰）。
async fn chat_mute_outcomes(bin: &str, chat_ids: &[String]) -> HashMap<String, MuteOutcome> {
    let mut out = HashMap::new();
    for chunk in chat_ids.chunks(10) {
        let items = match crate::lark_cli::chat_user_settings(bin, chunk).await {
            Ok(d) => d["items"].as_array().cloned(),
            Err(e) => {
                log::warn!("feishu: lark-cli 查询免打扰状态失败（跳过过滤）: {e}");
                for id in chunk {
                    out.insert(id.clone(), MuteOutcome::Unknown);
                }
                continue;
            }
        };
        let mut muted_here = HashSet::new();
        for item in items.unwrap_or_default() {
            if item["is_muted"].as_bool() == Some(true) {
                if let Some(id) = item["chat_id"].as_str() {
                    muted_here.insert(id.to_string());
                }
            }
        }
        for id in chunk {
            let outcome = if muted_here.contains(id) {
                MuteOutcome::Muted
            } else {
                MuteOutcome::Unmuted
            };
            out.insert(id.clone(), outcome);
        }
    }
    out
}

// ---- 会话过滤决策（feishu-chat-filter）----
// 枚举字面值是跨层契约（SQL CHECK / command 出参 / 前端 types.ts 三处镜像），改值需三处同步。

/// 会话过滤偏好。Follow = 无偏好行（跟随免打扰推导），不落库。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FilterPref {
    Follow,
    AlwaysFilter,
    AlwaysPull,
}

/// 免打扰查询结果三值态：Unknown = 该会话所在查询批次失败（降级不过滤）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MuteOutcome {
    Muted,
    Unmuted,
    Unknown,
}

/// 过滤生效状态（派生态，读取时现算不落库）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FilterEffect {
    Pull,
    Filter,
}

/// 生效状态来源；FollowDegraded 是独立来源值（前端零合并直出），
/// 字面值注意是驼峰 "followDegraded"（契约 AD §4.1）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FilterSource {
    Manual,
    Follow,
    FollowDegraded,
}

impl FilterPref {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            FilterPref::Follow => "follow",
            FilterPref::AlwaysFilter => "always_filter",
            FilterPref::AlwaysPull => "always_pull",
        }
    }

    /// 封闭枚举解析（command 入参校验用，非法值 None）
    pub(crate) fn parse(s: &str) -> Option<Self> {
        match s {
            "follow" => Some(FilterPref::Follow),
            "always_filter" => Some(FilterPref::AlwaysFilter),
            "always_pull" => Some(FilterPref::AlwaysPull),
            _ => None,
        }
    }
}

impl MuteOutcome {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            MuteOutcome::Muted => "muted",
            MuteOutcome::Unmuted => "unmuted",
            MuteOutcome::Unknown => "unknown",
        }
    }

    /// 快照表 mute_outcome 文本解析（CHECK 已约束三值，坏数据按 unknown 兜底）
    pub(crate) fn parse(s: &str) -> Self {
        match s {
            "muted" => MuteOutcome::Muted,
            "unmuted" => MuteOutcome::Unmuted,
            _ => MuteOutcome::Unknown,
        }
    }
}

impl FilterEffect {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            FilterEffect::Pull => "pull",
            FilterEffect::Filter => "filter",
        }
    }
}

impl FilterSource {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            FilterSource::Manual => "manual",
            FilterSource::Follow => "follow",
            FilterSource::FollowDegraded => "followDegraded",
        }
    }
}

/// 过滤决策纯函数（单一决策源：拉取侧 retain 与管理界面总览共用）。
/// 优先级：手动覆盖不读免打扰结果；跟随态 muted→过滤 / unmuted→拉取 /
/// unknown（所在批次查询失败）→降级为拉取（独立来源值 FollowDegraded）。
pub(crate) fn filter_decision(
    pref: FilterPref,
    outcome: MuteOutcome,
) -> (FilterEffect, FilterSource) {
    match pref {
        FilterPref::AlwaysFilter => (FilterEffect::Filter, FilterSource::Manual),
        FilterPref::AlwaysPull => (FilterEffect::Pull, FilterSource::Manual),
        FilterPref::Follow => match outcome {
            MuteOutcome::Muted => (FilterEffect::Filter, FilterSource::Follow),
            MuteOutcome::Unmuted => (FilterEffect::Pull, FilterSource::Follow),
            MuteOutcome::Unknown => (FilterEffect::Pull, FilterSource::FollowDegraded),
        },
    }
}

#[derive(Default)]
struct MsgPage {
    items: Option<Vec<serde_json::Value>>,
    has_more: bool,
    page_token: Option<String>,
}

/// 会话类型词表（与 chat_messages.chat_type 同）：bot = 与机器人的单聊，
/// p2p = 其他单聊，group = 群聊。快照与消息入库共用同一推导。
fn chat_type_of(chat: &ChatSummary) -> &'static str {
    if chat.chat_mode == "p2p" {
        if chat.p2p_target_type.as_deref() == Some("bot") {
            "bot"
        } else {
            "p2p"
        }
    } else {
        "group"
    }
}

/// 快照行：该轮的观测事实（会话 + 免打扰查询结果）；生效状态读取时现算，不落库。
pub(crate) struct ChatSnapshotRow {
    pub chat_id: String,
    pub chat_name: String,
    pub chat_type: String,
    pub mute_outcome: MuteOutcome,
}

/// 每轮一次的全量偏好读（本地毫秒级；无行 = Follow 跟随态）。
/// 读失败按空偏好处理（跟随后续轮重读），与 cached_names 的容错风格一致。
fn load_filter_prefs(conn: &Connection) -> HashMap<String, FilterPref> {
    let mut out = HashMap::new();
    let Ok(mut stmt) = conn.prepare("SELECT chat_id, preference FROM chat_filter_prefs") else {
        return out;
    };
    let Ok(rows) = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
    else {
        return out;
    };
    for (chat_id, pref) in rows.flatten() {
        if let Some(p) = FilterPref::parse(&pref) {
            out.insert(chat_id, p);
        }
    }
    out
}

/// 快照事务（单事务原子执行）：
/// ① DELETE FROM feishu_chats（整表替换，行随每轮生灭不牵连偏好）；
/// ② 批量 INSERT 全部会话（含被过滤者——管理界面要列全部，非仅幸存者）；
/// ③ UPSERT settings.feishu_snapshot_at（快照时间唯一载体：零会话轮无行可携带，
///   仍推进该键，「从未成功拉取」与「零会话账号」两种空态靠它区分）。
fn write_chat_snapshot(conn: &Connection, rows: &[ChatSnapshotRow]) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM feishu_chats", [])?;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO feishu_chats (chat_id, chat_name, chat_type, mute_outcome)
             VALUES (?1, ?2, ?3, ?4)",
        )?;
        for r in rows {
            stmt.execute(params![
                r.chat_id,
                r.chat_name,
                r.chat_type,
                r.mute_outcome.as_str()
            ])?;
        }
    }
    tx.execute(
        "INSERT INTO settings (key, value) VALUES ('feishu_snapshot_at', ?1)
         ON CONFLICT(key) DO UPDATE SET value=?1",
        params![now()],
    )?;
    tx.commit()?;
    Ok(())
}

/// 会话消息页（时间窗为秒级时间戳）
async fn messages_page(
    bin: &str,
    chat_id: &str,
    start_s: i64,
    end_s: i64,
    page_token: Option<&str>,
) -> AppResult<MsgPage> {
    let d = crate::lark_cli::list_messages(bin, chat_id, start_s, end_s, page_token).await?;
    Ok(MsgPage {
        items: d["items"].as_array().cloned(),
        has_more: d["has_more"].as_bool().unwrap_or(false),
        page_token: d["page_token"].as_str().map(String::from),
    })
}

/// 群成员列表（open_id + 姓名，翻页聚合），失败不阻断（发送者退化为短 id）
async fn chat_members(bin: &str, chat_id: &str) -> Vec<(String, String)> {
    let mut out = vec![];
    let mut page_token: Option<String> = None;
    for _ in 0..MEMBERS_MAX_PAGES {
        match crate::lark_cli::list_members(bin, chat_id, page_token.as_deref()).await {
            Ok(d) => {
                for item in d["items"].as_array().cloned().unwrap_or_default() {
                    if let Some(id) = item["member_id"].as_str().filter(|s| !s.is_empty()) {
                        out.push((
                            id.to_string(),
                            item["name"].as_str().unwrap_or_default().to_string(),
                        ));
                    }
                }
                let has_more = d["has_more"].as_bool().unwrap_or(false);
                page_token = d["page_token"].as_str().map(String::from);
                if !has_more || page_token.is_none() {
                    break;
                }
            }
            Err(e) => {
                log::warn!("feishu: lark-cli 拉取群「{chat_id}」成员失败: {e}");
                break;
            }
        }
    }
    out
}

/// 入库前的一条消息（含会话/发送者元数据与是否送 AI）
struct NewMessage {
    message_id: String,
    chat_id: String,
    chat_name: String,
    /// p2p / group / bot（与机器人的单聊）
    chat_type: String,
    sender_id: String,
    sender_name: String,
    is_self: bool,
    sent_at: i64,
    content: String,
    /// 送大模型的匿名版（人名代号化）；老数据空串，使用时回退现场 scrub
    content_anon: String,
    /// "" / "at"（显式 @到我）：归属标注的数据源
    at_me: &'static str,
    needs_ai: bool,
}

/// 纯媒体类消息：保留占位符入上下文，但不送 AI 判定
fn is_media_only(msg_type: &str) -> bool {
    matches!(
        msg_type,
        "image"
            | "audio"
            | "media"
            | "file"
            | "sticker"
            | "share_chat"
            | "share_user"
            | "merged_forward"
    )
}

/// 消息渲染产物：display 给用户看（真名原样），anon 送大模型（人名已代号化）。
/// at_me = 显式 @到我（mention 结构 open_id 命中），供归属标注；匿名版里它渲染成「@我」。
#[derive(Debug, PartialEq)]
pub(crate) struct Rendered {
    pub display: String,
    pub anon: String,
    pub at_me: bool,
}

/// 把消息 body.content 渲染成可读文本（用户版 + 大模型匿名版）。
/// text/post/卡片保留语义结构（@人、链接），媒体类给占位符，无法理解的返回 None 跳过。
/// mentions：消息级 @ 映射（key "@_user_1" → name/open_id），text 占位符与 post 的 user_key 都靠它还原。
/// my_open_id：授权用户自己的 open_id——@到我 在 display/anon 都渲染成「@我」，
/// 其他人在 anon 版渲染成稳定代号（AnonRules 需先对消息内 open_id 预分配）。
fn render_content(
    msg_type: &str,
    content: &str,
    mentions: &serde_json::Value,
    my_open_id: &str,
    resolve_name: &dyn Fn(&str) -> Option<String>,
    rules: &crate::anonymize::AnonRules,
) -> Option<Rendered> {
    let v: serde_json::Value = serde_json::from_str(content).ok()?;
    let mention_name = |key: &str| -> Option<String> {
        mentions
            .as_array()?
            .iter()
            .find(|m| m["key"].as_str() == Some(key))
            .and_then(|m| {
                if m["id"]["open_id"].as_str() == Some(my_open_id) && !my_open_id.is_empty() {
                    return Some("我".into());
                }
                let named = m["name"].as_str().map(String::from);
                named.or_else(|| m["id"]["open_id"].as_str().and_then(resolve_name))
            })
    };
    // user_key（@_user_N）→ open_id：匿名版 at 段定位代号用
    let mention_oid = |key: &str| -> Option<String> {
        mentions
            .as_array()?
            .iter()
            .find(|m| m["key"].as_str() == Some(key))
            .and_then(|m| m["id"]["open_id"].as_str().map(String::from))
    };
    // 显式 @到我：消息级 mentions 命中即算（text 占位符与 post 的 at 段同源）
    let at_me = !my_open_id.is_empty()
        && mentions
            .as_array()
            .map(|arr| {
                arr.iter()
                    .any(|m| m["id"]["open_id"].as_str() == Some(my_open_id))
            })
            .unwrap_or(false);
    match msg_type {
        "text" => {
            let raw = v["text"].as_str()?.to_string();
            let mut display = raw.clone();
            let mut anon = raw;
            if let Some(arr) = mentions.as_array() {
                for m in arr {
                    let Some(key) = m["key"].as_str() else {
                        continue;
                    };
                    let oid = m["id"]["open_id"].as_str().unwrap_or_default();
                    let display_name = if oid == my_open_id && !my_open_id.is_empty() {
                        "我".to_string()
                    } else {
                        m["name"]
                            .as_str()
                            .map(String::from)
                            .or_else(|| (!oid.is_empty()).then(|| resolve_name(oid)).flatten())
                            .unwrap_or_else(|| "成员".into())
                    };
                    let anon_name = rules.alias_cached(oid);
                    display = display.replace(key, &format!("@{display_name}"));
                    anon = anon.replace(key, &format!("@{anon_name}"));
                }
            }
            Some(Rendered {
                display,
                anon: rules.scrub(&anon),
                at_me,
            })
        }
        "post" => {
            // 富文本可能按语言分包（zh_cn/en_us/...），取第一个语言包，否则整体即内容
            let body = ["zh_cn", "en_us", "ja_jp"]
                .iter()
                .find_map(|k| v[k].as_object().map(|_| &v[k]))
                .unwrap_or(&v);
            let title = body["title"].as_str().filter(|s| !s.is_empty());
            let paragraphs = body["content"].as_array()?;
            let mut display_lines = vec![];
            let mut anon_lines = vec![];
            if let Some(t) = title {
                display_lines.push(t.to_string());
                anon_lines.push(rules.scrub(t));
            }
            for para in paragraphs {
                let mut display_line = vec![];
                let mut anon_line = vec![];
                if let Some(segs) = para.as_array() {
                    for seg in segs {
                        let (d, a) = render_post_segment(
                            seg,
                            &mention_name,
                            &mention_oid,
                            resolve_name,
                            rules,
                        );
                        display_line.push(d);
                        anon_line.push(a);
                    }
                }
                let join = |line: Vec<String>| {
                    line.into_iter()
                        .filter(|s| !s.is_empty())
                        .collect::<Vec<_>>()
                        .join(" ")
                };
                display_lines.push(join(display_line));
                anon_lines.push(join(anon_line));
            }
            Some(Rendered {
                display: display_lines.join("\n"),
                anon: anon_lines.join("\n"),
                at_me,
            })
        }
        "interactive" => {
            // 卡片消息（机器人通知居多）：收集文本节点拼一段摘要
            let mut buf = String::new();
            fn walk(v: &serde_json::Value, buf: &mut String) {
                if buf.chars().count() > 500 {
                    return;
                }
                if let Some(obj) = v.as_object() {
                    for (k, x) in obj {
                        if k == "text" || k == "content" || k == "title" {
                            if let Some(s) = x.as_str().filter(|s| !s.trim().is_empty()) {
                                buf.push_str(s);
                                buf.push(' ');
                            }
                        }
                        walk(x, buf);
                    }
                } else if let Some(arr) = v.as_array() {
                    for x in arr {
                        walk(x, buf);
                    }
                }
            }
            walk(&v, &mut buf);
            let s = buf.trim().to_string();
            if s.is_empty() {
                None
            } else {
                Some(Rendered {
                    display: format!("[卡片] {s}"),
                    anon: format!("[卡片] {}", rules.scrub(&s)),
                    at_me: false,
                })
            }
        }
        "image" => placeholder("[图片]"),
        "audio" => placeholder("[语音]"),
        "media" => placeholder("[视频]"),
        "file" => {
            let name = v["file_name"].as_str().unwrap_or_default();
            let s = if name.is_empty() {
                "[文件]".into()
            } else {
                format!("[文件:{name}]")
            };
            placeholder(&s)
        }
        "sticker" => placeholder("[表情]"),
        "share_chat" => placeholder("[群名片]"),
        "share_user" => placeholder("[个人名片]"),
        "merged_forward" => placeholder("[合并转发]"),
        _ => None,
    }
}

/// 媒体占位符：两版相同（不含人名）
fn placeholder(s: &str) -> Option<Rendered> {
    Some(Rendered {
        display: s.into(),
        anon: s.into(),
        at_me: false,
    })
}

/// post 富文本的单个元素 → (用户版, 匿名版) 文本。
/// at 段：display 用真名（@到我 → @我），anon 用代号；text/a 段匿名版过称呼/成员名替换。
fn render_post_segment(
    seg: &serde_json::Value,
    mention_name: &dyn Fn(&str) -> Option<String>,
    mention_oid: &dyn Fn(&str) -> Option<String>,
    resolve_name: &dyn Fn(&str) -> Option<String>,
    rules: &crate::anonymize::AnonRules,
) -> (String, String) {
    let tag = seg["tag"].as_str().unwrap_or_default();
    match tag {
        "text" => {
            let t = seg["text"].as_str().unwrap_or_default();
            (t.to_string(), rules.scrub(t))
        }
        "a" => {
            let text = seg["text"].as_str().unwrap_or_default();
            let href = seg["href"].as_str().filter(|h| !h.is_empty());
            match href {
                Some(href) => (
                    format!("{text}({href})"),
                    format!("{}({href})", rules.scrub(text)),
                ),
                None => (text.to_string(), rules.scrub(text)),
            }
        }
        "at" => {
            let key = seg["user_key"].as_str().unwrap_or_default();
            let display = (!key.is_empty())
                .then(|| mention_name(key))
                .flatten()
                .or_else(|| {
                    seg["user_id"]
                        .as_str()
                        .or_else(|| seg["open_id"].as_str())
                        .and_then(resolve_name)
                })
                .unwrap_or_else(|| "成员".into());
            // 匿名版：能定位到 open_id 就走代号（@到我 由 alias_cached 直接给「我」）；
            // user_key 查不到 mentions 时它本身常就是 open_id
            let oid = (!key.is_empty())
                .then(|| mention_oid(key))
                .flatten()
                .or_else(|| {
                    seg["user_id"]
                        .as_str()
                        .or_else(|| seg["open_id"].as_str())
                        .map(String::from)
                })
                .unwrap_or_default();
            let anon = rules.alias_cached(&oid);
            (format!("@{display}"), format!("@{anon}"))
        }
        "img" => ("[图片]".into(), "[图片]".into()),
        "media" => ("[视频]".into(), "[视频]".into()),
        "emotion" => ("[表情]".into(), "[表情]".into()),
        _ => (String::new(), String::new()),
    }
}

/// 计算拉取窗口（秒级时间戳）。
/// 飞书 im/v1/messages 的 start_time/end_time 只接受秒，传毫秒会落到远未来窗口、
/// 永远返回空列表；游标内部仍以毫秒存储，出口处统一转秒。
/// 首次拉取（无游标）回看 24 小时，兼顾"装好后能捞到当天消息"与不触发海量历史。
fn window_secs(since_ms: Option<i64>, now_ms: i64) -> (i64, i64) {
    let start = since_ms
        .map(|s| s - 120_000) // 回退 2 分钟容错
        .unwrap_or(now_ms - 24 * 3_600_000);
    (start / 1000, now_ms / 1000)
}

/// feishu_users 名字缓存（open_id → 姓名），群消息发送者显示名靠它
fn cached_names(db: &Db) -> HashMap<String, String> {
    let conn = db.0.lock().unwrap();
    let mut out = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT open_id, name FROM feishu_users") {
        if let Ok(rows) =
            stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        {
            for row in rows.flatten() {
                out.insert(row.0, row.1);
            }
        }
    }
    out
}

fn save_names(db: &Db, names: &[(String, String)]) {
    if names.is_empty() {
        return;
    }
    let Ok(conn) = db.0.lock() else { return };
    for (open_id, name) in names {
        let _ = conn.execute(
            "INSERT INTO feishu_users (open_id, name, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(open_id) DO UPDATE SET name=?2, updated_at=?3",
            params![open_id, name, now()],
        );
    }
}

/// 用户身份增量拉取。消息处理语境：
/// - 与机器人的单聊（lark-cli 用它自己的内置应用身份，无「本应用机器人」概念，
///   靠会话级 p2p_target_type=bot 识别）：只把「当前用户发给机器人的」送 AI；
/// - 与他人的单聊：只把「对方发来的」送 AI（用户自己发出的作上下文）；
/// - 群聊：除自己外的消息送 AI。
async fn pull_new_messages(
    bin: &str,
    db: &Db,
    since_ms: Option<i64>,
) -> AppResult<(Vec<NewMessage>, i64)> {
    let (my_open_id, my_name) = crate::lark_cli::user_identity(bin).await?;
    // 身份落 settings：pk context 脱敏词源（我的称呼）在 CLI 进程里离线可读
    let mut rules = {
        let conn = db.0.lock().unwrap();
        for (k, v) in [
            ("feishu_my_open_id", my_open_id.as_str()),
            ("feishu_my_name", my_name.as_str()),
        ] {
            let _ = conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value=?2",
                params![k, v],
            );
        }
        crate::anonymize::AnonRules::build(&conn)
    };
    let mut chats = chats(bin).await?;
    if chats.is_empty() {
        log::info!("feishu: 授权用户不在任何会话中，无消息可拉取");
    }
    // 过滤决策点（feishu-chat-filter）：手动偏好优先、无偏好跟随免打扰（查询失败按会话降级）。
    // 快照写在 retain 前（本轮决策已定格）、含被过滤会话（管理界面要列全部）；
    // 后续消息分页失败时快照也如实反映本轮观测；user_identity / chats() 阶段失败则
    // 保留上一轮快照（陈旧度容忍一个退避周期）。
    let chat_ids: Vec<String> = chats.iter().map(|c| c.chat_id.clone()).collect();
    let outcomes = chat_mute_outcomes(bin, &chat_ids).await;
    let prefs = {
        let conn = db.0.lock().unwrap();
        load_filter_prefs(&conn)
    };
    let outcome_of = |id: &str| outcomes.get(id).copied().unwrap_or(MuteOutcome::Unmuted);
    let pref_of = |id: &str| prefs.get(id).copied().unwrap_or(FilterPref::Follow);
    let snapshot: Vec<ChatSnapshotRow> = chats
        .iter()
        .map(|c| ChatSnapshotRow {
            chat_id: c.chat_id.clone(),
            chat_name: c.name.clone(),
            chat_type: chat_type_of(c).to_string(),
            mute_outcome: outcome_of(&c.chat_id),
        })
        .collect();
    {
        let conn = db.0.lock().unwrap();
        write_chat_snapshot(&conn, &snapshot)?;
    }
    let before = chats.len();
    chats.retain(|c| {
        filter_decision(pref_of(&c.chat_id), outcome_of(&c.chat_id)).0 == FilterEffect::Pull
    });
    let filtered_out = before - chats.len();
    if filtered_out > 0 {
        log::debug!("feishu: 跳过 {filtered_out} 个被过滤会话（手动偏好或免打扰跟随）");
    }
    let mut names = cached_names(db);
    let mut refreshed_chats: HashSet<String> = HashSet::new();

    let now_ms = chrono::Utc::now().timestamp_millis();
    let (start_s, end_s) = window_secs(since_ms, now_ms);
    let mut out = vec![];
    for chat in &chats {
        // 「发给自己的会话」（p2p 对端即本人）：我的消息视作备忘
        let target_is_self =
            chat.chat_mode == "p2p" && chat.p2p_target_id.as_deref() == Some(&my_open_id);
        // 处理当前会话的所有分页
        let mut page_token: Option<String> = None;
        let mut chat_count = 0usize;
        loop {
            let page =
                messages_page(bin, &chat.chat_id, start_s, end_s, page_token.as_deref()).await?;
            for m in page.items.unwrap_or_default() {
                let message_id = m["message_id"].as_str().unwrap_or_default().to_string();
                if message_id.is_empty() {
                    continue;
                }
                let msg_type = m["msg_type"].as_str().unwrap_or_default();
                let content = m["body"]["content"].as_str().unwrap_or_default();
                let sender_id = m["sender"]["id"].as_str().unwrap_or("unknown").to_string();
                let sender_type = m["sender"]["sender_type"].as_str().unwrap_or("user");
                // create_time 为毫秒字符串；异常时用当前时间兜底
                let sent_at = m["create_time"]
                    .as_str()
                    .and_then(|s| s.parse::<i64>().ok())
                    .unwrap_or(now_ms);
                let mentions = &m["mentions"];
                let names_ref = &names;
                let resolve = move |oid: &str| names_ref.get(oid).cloned();
                // 渲染前预分配本条消息所有 mention 的代号：render_content 对规则包只读
                {
                    let conn = db.0.lock().unwrap();
                    for mm in mentions.as_array().into_iter().flatten() {
                        if let Some(oid) = mm["id"]["open_id"].as_str() {
                            rules.alias_of(&conn, oid);
                        }
                    }
                }
                let Some(rendered) =
                    render_content(msg_type, content, mentions, &my_open_id, &resolve, &rules)
                else {
                    continue;
                };
                if rendered.display.trim().is_empty() {
                    continue;
                }
                let is_self = sender_type == "user" && sender_id == my_open_id;
                let chat_type = chat_type_of(chat);
                let needs_ai = match chat_type {
                    "bot" => is_self,
                    "p2p" => !is_self || target_is_self,
                    _ => !is_self,
                } && !is_media_only(msg_type);
                // 发送者显示名：自己/单聊对方（会话名即对方）/群成员缓存
                let sender_name = if is_self {
                    my_name.clone()
                } else if chat.chat_mode == "p2p" {
                    chat.name.clone()
                } else if sender_type != "user" {
                    "应用".to_string()
                } else {
                    match names.get(&sender_id) {
                        Some(n) if !n.is_empty() => n.clone(),
                        _ => {
                            // 首次遇到陌生发送者：拉一次群成员名单补缓存（每群每轮最多一次）
                            if !refreshed_chats.contains(&chat.chat_id) {
                                refreshed_chats.insert(chat.chat_id.clone());
                                let members = chat_members(bin, &chat.chat_id).await;
                                save_names(db, &members);
                                for (oid, n) in &members {
                                    names.insert(oid.clone(), n.clone());
                                }
                            }
                            names
                                .get(&sender_id)
                                .filter(|n| !n.is_empty())
                                .cloned()
                                .unwrap_or_else(|| short_id(&sender_id))
                        }
                    }
                };
                log::debug!(
                    "feishu: 新消息「{chat_type}·{}」{sender_name}: {}",
                    chat.name,
                    rendered.display
                );
                out.push(NewMessage {
                    message_id,
                    chat_id: chat.chat_id.clone(),
                    chat_name: chat.name.clone(),
                    chat_type: chat_type.to_string(),
                    sender_id,
                    sender_name,
                    is_self,
                    sent_at,
                    content: rendered.display,
                    content_anon: rendered.anon.clone(),
                    at_me: if rendered.at_me {
                        "at"
                    } else if rules.hints_me(&rendered.anon) {
                        "name"
                    } else {
                        ""
                    },
                    needs_ai,
                });
                chat_count += 1;
            }
            if !page.has_more {
                break;
            }
            page_token = page.page_token;
        }
        log::debug!("feishu: 会话「{}」本轮共 {chat_count} 条消息", chat.name);
    }
    Ok((out, now_ms))
}

/// open_id 过长，缓存未命中时截短展示（如 ou_ab12cd34）
fn short_id(id: &str) -> String {
    id.chars().take(11).collect()
}

/// 连接测试：验证身份 + 会话可见性
pub async fn poll_once_test(bin: &str) -> AppResult<String> {
    let (_, name) = crate::lark_cli::user_identity(bin).await?;
    let chats = chats(bin).await?;
    let groups = chats.iter().filter(|c| c.chat_mode != "p2p").count();
    let p2p = chats.len() - groups;
    Ok(format!(
        "连接成功（lark-cli）：已授权「{name}」，可见 {} 个会话（群聊 {groups} · 单聊 {p2p}）",
        chats.len()
    ))
}

/// 拉取 in-flight 守卫（AD §6，既有缺口顺带修）：后台轮询循环与设置页「测试/立即拉取」、
/// 过滤卡的「立即拉取」按钮共用 poll_once，无互斥时并发触发会让 lark-cli 子进程调用翻倍
/// （消息入库有 message_id 判重兜底，但属浪费与竞态）。放聚合层（非 command 层）使
/// 所有调用方共用同一互斥；UIUX「两按钮 busy 态不联动、并发由后端守卫兜底」由此成立。
static POLL_IN_FLIGHT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// 一轮完整的"拉取 → 全量入库（待判定/仅上下文）→ AI 分类（带判重与同会话上下文）
/// → 更新消息状态 → 清理过期消息"。外层同时登记飞书链路健康（成功/失败）。
pub async fn poll_once<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<usize> {
    // CAS 抢占；占用中立即返回冲突错误。错误类型复用 AppError::External（无 Busy/Conflict
    // 变体，语义最近：本轮外部链路（lark-cli）调用因上一轮在飞而被拒绝执行；非用户输入
    // 问题不用 Invalid；瞬时占用无需前端重试标记，不用 Network）
    use std::sync::atomic::Ordering;
    if POLL_IN_FLIGHT
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .is_err()
    {
        return Err(AppError::External(
            "上一轮飞书拉取仍在进行中，请稍候再试".into(),
        ));
    }
    let result = poll_once_inner(app).await;
    // 任何路径（含错误）释放守卫：inner 返回 Result，无早退穿越
    POLL_IN_FLIGHT.store(false, Ordering::Release);
    let state = app.state::<crate::health::HealthState>();
    match &result {
        Ok(_) => state.record_success(app, crate::health::FEISHU),
        Err(e) => state.record_failure(app, crate::health::FEISHU, &e.to_string()),
    }
    result
}

async fn poll_once_inner<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<usize> {
    let db = app.state::<Db>();
    let get = |k: &str| -> Option<String> {
        let conn = db.0.lock().unwrap();
        conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
            r.get::<_, String>(0)
        })
        .ok()
    };
    let bin = crate::lark_cli::lark_bin();
    let agent = match ai::primary_agent(&get) {
        Some(a) => a,
        None => {
            return Err(AppError::Invalid(
                "已启用飞书拉取但未配置 AI Agent，无法分类".into(),
            ))
        }
    };

    let since: Option<i64> = get("feishu_cursor").and_then(|s| s.parse().ok());
    let (messages, cursor) = pull_new_messages(&bin, &db, since).await?;
    // 快照事务已随拉取提交（含零会话轮）：无条件广播，管理界面据此刷新陈旧度与计数
    // （与 CHAT_MESSAGES_CHANGED 仅新消息时 emit 不同，此为刻意选择，AD §4.2；
    // 消息分页等后续步骤失败的错误轮不 emit，界面延迟到下一成功轮刷新）
    events::broadcast(app, events::FEISHU_CHAT_FILTER_CHANGED);

    // 1. 全量入库：待判定的进收音机，其余（自己发的、机器人回复等）标记 skipped 只作上下文
    let fresh: Vec<NewMessage> = {
        let conn = db.0.lock().unwrap();
        messages
            .into_iter()
            .filter(|m| {
                let known: bool = conn
                    .query_row(
                        "SELECT 1 FROM chat_messages WHERE message_id=?1",
                        params![m.message_id],
                        |_| Ok(true),
                    )
                    .is_ok();
                !known
            })
            .collect()
    };
    {
        let conn = db.0.lock().unwrap();
        for m in &fresh {
            let sent_rfc3339 = chrono::DateTime::from_timestamp_millis(m.sent_at)
                .map(|t| t.to_rfc3339())
                .unwrap_or_else(now);
            conn.execute(
                "INSERT INTO chat_messages (message_id, chat_id, chat_name, chat_type, sender, sender_id,
                                            content, content_anon, at_me, sent_at, is_self, ai_status, review_status, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'pending',?13)",
                params![
                    m.message_id,
                    m.chat_id,
                    m.chat_name,
                    m.chat_type,
                    m.sender_name,
                    m.sender_id,
                    m.content,
                    m.content_anon,
                    m.at_me,
                    m.sent_at,
                    m.is_self as i64,
                    if m.needs_ai { "pending" } else { "skipped" },
                    sent_rfc3339,
                ],
            )?;
        }
    }
    if fresh.is_empty() {
        log::debug!("feishu: 本轮无新消息");
    } else {
        let pending = fresh.iter().filter(|m| m.needs_ai).count();
        log::info!(
            "feishu: 本轮拉取 {} 条消息（{pending} 条待 AI 判定，其余作上下文）",
            fresh.len()
        );
    }

    // 2. 分批送 AI（每批 20 条，避免超 token），带同会话近期消息作上下文。
    //    判定管道（会话回链 / 健康登记 / 失败挽救与迟到回调回看）与「重判失败」共用
    let actionable: Vec<&NewMessage> = fresh.iter().filter(|m| m.needs_ai).collect();
    let mut saved = 0usize;
    for chunk in actionable.chunks(20) {
        let batch = {
            let conn = db.0.lock().unwrap();
            let mut rules = crate::anonymize::AnonRules::build(&conn);
            chunk
                .iter()
                .map(|m| {
                    let context = crate::commands::radio::chat_context_lines(
                        &conn,
                        &m.chat_id,
                        m.sent_at,
                        &m.message_id,
                        CONTEXT_WINDOW_MS,
                        CONTEXT_MAX_MESSAGES,
                    );
                    AiMessage {
                        message_id: m.message_id.clone(),
                        // 送 AI 的 sender 用代号（「我」/成员_xxxx），真名不进 prompt
                        sender: if m.is_self {
                            crate::anonymize::ME.to_string()
                        } else {
                            rules.alias_of(&conn, &m.sender_id)
                        },
                        chat_label: crate::commands::radio::chat_label(&m.chat_type, &m.chat_name),
                        content: m.content_anon.clone(),
                        context: crate::commands::radio::format_context_lines(
                            &conn, &mut rules, context,
                        ),
                        mention_note: crate::ai::mention_note(
                            m.at_me,
                            &m.content_anon,
                            rules.same_name_risk,
                        ),
                    }
                })
                .collect::<Vec<_>>()
        };
        saved += crate::commands::radio::classify_and_apply(app, &db, &agent, &batch).await?;
    }

    if !fresh.is_empty() {
        let _ = app.emit(events::CHAT_MESSAGES_CHANGED, fresh.len());
    }

    // 3. 清理：超过 60 天仍未创建待办的消息
    {
        let conn = db.0.lock().unwrap();
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(60)).to_rfc3339();
        let removed = conn.execute(
            "DELETE FROM chat_messages WHERE task_id IS NULL AND created_at < ?1",
            params![cutoff],
        )?;
        if removed > 0 {
            log::info!("feishu: 清理 {removed} 条超期未捕捉消息（>60 天）");
        }
    }

    {
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO sync_state (provider, cursor, updated_at) VALUES ('feishu', ?1, ?2)
             ON CONFLICT(provider) DO UPDATE SET cursor=?1, updated_at=?2",
            params![cursor.to_string(), now()],
        )?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('feishu_cursor', ?1) ON CONFLICT(key) DO UPDATE SET value=?1",
            params![cursor.to_string()],
        )?;
    }
    Ok(saved)
}

/// 后台轮询循环：间隔从设置读取（默认 120 秒），失败指数退避（上限 8 倍）
pub fn spawn_poll_loop(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut backoff = 1u64;
        loop {
            let (enabled, interval) = {
                let db = app.state::<Db>();
                let conn = db.0.lock().unwrap();
                let enabled = conn
                    .query_row(
                        "SELECT value FROM settings WHERE key='feishu_enabled'",
                        [],
                        |r| r.get::<_, String>(0),
                    )
                    .ok()
                    .map(|v| v == "true")
                    .unwrap_or(false);
                let interval = conn
                    .query_row(
                        "SELECT value FROM settings WHERE key='feishu_poll_interval'",
                        [],
                        |r| r.get::<_, String>(0),
                    )
                    .ok()
                    .and_then(|v| v.parse::<u64>().ok())
                    .filter(|s| *s >= 30)
                    .unwrap_or(120);
                (enabled, interval)
            };
            if enabled {
                match poll_once(&app).await {
                    Ok(_) => backoff = 1,
                    Err(e) => {
                        log::warn!("feishu poll failed: {e}");
                        backoff = (backoff * 2).min(8);
                    }
                }
            }
            let sleep_secs = interval * backoff;
            // 入睡前登记下次预计轮询时间（诊断页倒计时展示）
            app.state::<crate::health::HealthState>().set_next_run(
                crate::health::FEISHU,
                chrono::Utc::now().timestamp_millis() + sleep_secs as i64 * 1000,
            );
            tokio::time::sleep(Duration::from_secs(sleep_secs)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::test_conn;
    use std::sync::Mutex;

    fn test_db() -> Db {
        Db(Mutex::new(test_conn()))
    }

    // ---- render_content：富文本与占位符渲染 ----

    /// 渲染测试的规则包：内存库 + 固定身份（我=ou_me/乔老板，张三=ou_z/成员_00aa）
    fn render_rules(my_name: &str) -> crate::anonymize::AnonRules {
        let conn = test_conn();
        let setting = |k: &str, v: &str| {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value=?2",
                params![k, v],
            )
            .unwrap();
        };
        setting("feishu_my_open_id", "ou_me");
        if !my_name.is_empty() {
            setting("feishu_my_name", my_name);
        }
        conn.execute(
            "INSERT INTO feishu_users (open_id, name, alias, updated_at)
             VALUES ('ou_z', '张三', '成员_00aa', '2026-09-01')",
            [],
        )
        .unwrap();
        crate::anonymize::AnonRules::build(&conn)
    }

    #[test]
    fn render_text_message_with_mentions() {
        let rules = render_rules("");
        let content = r#"{"text":"@_user_1 看一下这个"}"#;
        let mentions = serde_json::json!([
            {"key": "@_user_1", "name": "张三", "id": {"open_id": "ou_z"}}
        ]);
        let r = render_content("text", content, &mentions, "", &|_| None, &rules).unwrap();
        assert_eq!(r.display, "@张三 看一下这个");
        // 匿名版：他人替换成代号，真名不进 anon
        assert_eq!(r.anon, "@成员_00aa 看一下这个");
        assert!(!r.at_me);
        // @到我 的提及：display/anon 都渲染成「@我」（即使 name 字段是真名），at_me 标记
        let to_me = serde_json::json!([
            {"key": "@_user_1", "name": "本大爷", "id": {"open_id": "ou_me"}}
        ]);
        let r = render_content("text", content, &to_me, "ou_me", &|_| None, &rules).unwrap();
        assert_eq!(r.display, "@我 看一下这个");
        assert_eq!(r.anon, "@我 看一下这个");
        assert!(r.at_me);
        // 无 mentions 映射时 display 保留原文
        let r = render_content(
            "text",
            content,
            &serde_json::Value::Null,
            "",
            &|_| None,
            &rules,
        )
        .unwrap();
        assert_eq!(r.display, "@_user_1 看一下这个");
    }

    #[test]
    fn render_text_without_mention_marks_my_typed_name() {
        // 手打文本提及（无 mention 结构）：display 原样，anon 里我的称呼 → 疑似@我，
        // 其他成员 → 代号；归属标注的数据源（at_me=name）在 pull 链路据此判定
        let rules = render_rules("乔老板");
        let content = r#"{"text":"乔老板帮我看下，再找张三对一遍"}"#;
        let r = render_content(
            "text",
            content,
            &serde_json::Value::Null,
            "",
            &|_| None,
            &rules,
        )
        .unwrap();
        assert_eq!(r.display, "乔老板帮我看下，再找张三对一遍");
        assert!(r.anon.contains("（疑似@我）帮我看下"), "{}", r.anon);
        assert!(r.anon.contains("找成员_00aa对一遍"), "{}", r.anon);
        assert!(!r.anon.contains("乔老板") && !r.anon.contains("张三"));
    }

    #[test]
    fn render_post_rich_text_with_at_link_and_media() {
        let rules = render_rules("");
        let content = r#"{"title":"纪要","content":[[
            {"tag":"text","text":"周三前"},
            {"tag":"at","user_id":"ou_z"},
            {"tag":"a","text":"需求文档","href":"https://doc.example/x"},
            {"tag":"img","image_key":"k"}
        ]]}"#;
        let r = render_content(
            "post",
            content,
            &serde_json::Value::Null,
            "",
            &|id| (id == "ou_z").then(|| "张三".to_string()),
            &rules,
        )
        .unwrap();
        assert!(
            r.display.starts_with("纪要\n"),
            "标题单独成行: {}",
            r.display
        );
        assert!(r.display.contains("周三前"));
        assert!(
            r.display.contains("@张三"),
            "at 段解析成 @人名: {}",
            r.display
        );
        assert!(
            r.display.contains("需求文档(https://doc.example/x)"),
            "链接带 href: {}",
            r.display
        );
        assert!(r.display.contains("[图片]"), "图片给占位符: {}", r.display);
        // 匿名版：at 段走代号
        assert!(r.anon.contains("@成员_00aa"), "{}", r.anon);
        assert!(!r.anon.contains("张三"), "{}", r.anon);
    }

    #[test]
    fn render_post_localized_pack_and_media_placeholders() {
        let rules = render_rules("");
        // 语言包形态：取 zh_cn
        let content = r#"{"title":"外层","zh_cn":{"title":"中文标题","content":[[{"tag":"text","text":"你好"}]]}}"#;
        let r = render_content(
            "post",
            content,
            &serde_json::Value::Null,
            "",
            &|_| None,
            &rules,
        )
        .unwrap();
        assert_eq!(r.display, "中文标题\n你好");
        assert_eq!(r.anon, "中文标题\n你好");
        let img = render_content(
            "image",
            r#"{"image_key":"k"}"#,
            &serde_json::Value::Null,
            "",
            &|_| None,
            &rules,
        )
        .unwrap();
        assert_eq!(img.display, "[图片]");
        assert_eq!(img.anon, "[图片]");
        let f = render_content(
            "file",
            r#"{"file_name":"合同.pdf"}"#,
            &serde_json::Value::Null,
            "",
            &|_| None,
            &rules,
        )
        .unwrap();
        assert_eq!(f.display, "[文件:合同.pdf]");
        let a = render_content(
            "audio",
            "{}",
            &serde_json::Value::Null,
            "",
            &|_| None,
            &rules,
        )
        .unwrap();
        assert_eq!(a.display, "[语音]");
    }

    #[test]
    fn render_interactive_card_collects_text() {
        let rules = render_rules("乔老板");
        let content = r#"{"header":{"title":{"content":"审批提醒"}},"elements":[{"tag":"div","text":{"text":"乔老板提交了请假申请"}}]}"#;
        let r = render_content(
            "interactive",
            content,
            &serde_json::Value::Null,
            "",
            &|_| None,
            &rules,
        )
        .unwrap();
        assert!(r.display.starts_with("[卡片]"));
        assert!(
            r.display.contains("审批提醒") && r.display.contains("请假申请"),
            "{}",
            r.display
        );
        // 卡片文本节点同样过称呼替换，真名不进 anon
        assert!(r.anon.contains("（疑似@我）提交了请假申请"), "{}", r.anon);
    }

    #[test]
    fn render_unknown_and_invalid_returns_none() {
        let rules = render_rules("");
        assert_eq!(
            render_content(
                "system",
                "{}",
                &serde_json::Value::Null,
                "",
                &|_| None,
                &rules
            ),
            None,
            "系统消息跳过"
        );
        assert_eq!(
            render_content(
                "text",
                "not-json",
                &serde_json::Value::Null,
                "",
                &|_| None,
                &rules
            ),
            None,
            "非法 JSON 跳过"
        );
        assert!(is_media_only("image") && is_media_only("merged_forward"));
        assert!(!is_media_only("text") && !is_media_only("interactive"));
    }

    #[test]
    fn window_secs_uses_seconds_and_first_pull_looks_back_24h() {
        let now_ms = 1_789_211_331_894i64;
        // 首次拉取（无游标）：回看 24 小时，输出为秒级
        let (start, end) = window_secs(None, now_ms);
        assert_eq!(end, 1_789_211_331, "毫秒游标出口转秒");
        assert_eq!(start, end - 24 * 3600);
        // 增量拉取：上次游标回退 2 分钟容错
        let (start, end) = window_secs(Some(now_ms - 600_000), now_ms);
        assert_eq!(start, (now_ms - 600_000 - 120_000) / 1000);
        assert_eq!(end, now_ms / 1000);
    }

    /// 用户身份拉取全链路（假 lark-cli 脚本按 API 路由返回数据）：
    /// 三类会话的处理语境 + 免打扰整会话跳过 + 富文本/占位符 + 名字缓存兜底。
    /// lark-cli 引擎无「本应用机器人」语境：bot 单聊靠会话级 p2p_target_type 识别，
    /// 群里的应用消息按普通消息送 AI。
    #[cfg(unix)]
    #[test]
    fn pull_new_messages_applies_chat_type_rules() {
        tauri::async_runtime::block_on(async {
            let dir = std::env::temp_dir().join(format!("pk-lark-rules-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let script = dir.join("lark-cli");
            let t0 = 1_789_200_000_000i64; // 固定毫秒时间戳，断言 sent_at 换算
            std::fs::write(
                &script,
                r#"#!/bin/sh
case "$3" in
  /open-apis/authen/v1/user_info)
    printf '%s' '{"ok":true,"data":{"open_id":"ou_me","name":"乔老板"}}' ;;
  /open-apis/im/v1/chats)
    printf '%s' '{"ok":true,"data":{"items":[
        {"chat_id":"oc_bot","name":"皮卡丘助手","chat_mode":"p2p","p2p_target_type":"bot","p2p_target_id":"ou_bot2"},
        {"chat_id":"oc_friend","name":"李四","chat_mode":"p2p","p2p_target_type":"user","p2p_target_id":"ou_li"},
        {"chat_id":"oc_myself","name":"我","chat_mode":"p2p","p2p_target_type":"user","p2p_target_id":"ou_me"},
        {"chat_id":"oc_group","name":"项目群","chat_mode":"group"},
        {"chat_id":"oc_noisy","name":"灌水群","chat_mode":"group"}
      ],"has_more":false}}' ;;
  /open-apis/im/v1/chat_user_setting/batch_query)
    printf '%s' '{"ok":true,"data":{"items":[{"chat_id":"oc_noisy","is_muted":true}]}}' ;;
  /open-apis/im/v1/messages)
    case "$5" in
      *'"container_id":"oc_bot"'*)
        printf '%s' '{"ok":true,"data":{"items":[
            {"message_id":"om_b1","msg_type":"text","create_time":"1789200000000","sender":{"id":"ou_me","sender_type":"user"},"body":{"content":"{\"text\":\"提醒我明早9点站会\"}"}},
            {"message_id":"om_b2","msg_type":"text","create_time":"1789200001000","sender":{"id":"ou_bot","sender_type":"app"},"body":{"content":"{\"text\":\"收到啦，我会提醒你\"}"}}
          ],"has_more":false}}' ;;
      *'"container_id":"oc_friend"'*)
        printf '%s' '{"ok":true,"data":{"items":[
            {"message_id":"om_f1","msg_type":"text","create_time":"1789200000000","sender":{"id":"ou_li","sender_type":"user"},"body":{"content":"{\"text\":\"把合同发我一下\"}"}},
            {"message_id":"om_f2","msg_type":"text","create_time":"1789200001000","sender":{"id":"ou_me","sender_type":"user"},"body":{"content":"{\"text\":\"好的马上\"}"}}
          ],"has_more":false}}' ;;
      *'"container_id":"oc_myself"'*)
        printf '%s' '{"ok":true,"data":{"items":[
            {"message_id":"om_s1","msg_type":"text","create_time":"1789200000000","sender":{"id":"ou_me","sender_type":"user"},"body":{"content":"{\"text\":\"明早出门前寄快递\"}"}}
          ],"has_more":false}}' ;;
      *'"container_id":"oc_noisy"'*)
        printf '%s' '{"ok":true,"data":{"items":[
            {"message_id":"om_noisy","msg_type":"text","create_time":"1789200000000","sender":{"id":"ou_zhao","sender_type":"user"},"body":{"content":"{\"text\":\"灌水消息不该出现\"}"}}
          ],"has_more":false}}' ;;
      *'"container_id":"oc_group"'*)
        printf '%s' '{"ok":true,"data":{"items":[
            {"message_id":"om_g1","msg_type":"text","create_time":"1789200000000","sender":{"id":"ou_z","sender_type":"user"},"body":{"content":"{\"text\":\"@_user_1 周会改到周四10点\"}"},"mentions":[{"key":"@_user_1","name":"乔老板","id":{"open_id":"ou_me"}}]},
            {"message_id":"om_g2","msg_type":"text","create_time":"1789200001000","sender":{"id":"ou_me","sender_type":"user"},"body":{"content":"{\"text\":\"收到\"}"}},
            {"message_id":"om_g3","msg_type":"text","create_time":"1789200002000","sender":{"id":"ou_bot","sender_type":"app"},"body":{"content":"{\"text\":\"每日站会提醒\"}"}},
            {"message_id":"om_g4","msg_type":"image","create_time":"1789200003000","sender":{"id":"ou_z","sender_type":"user"},"body":{"content":"{\"image_key\":\"k\"}"}},
            {"message_id":"om_g5","msg_type":"text","create_time":"1789200004000","sender":{"id":"ou_z","sender_type":"user"},"body":{"content":"{\"text\":\"@_user_2 你来写周报\"}"},"mentions":[{"key":"@_user_2","name":"王五","id":{"open_id":"ou_wang"}}]},
            {"message_id":"om_g6","msg_type":"text","create_time":"1789200005000","sender":{"id":"ou_z","sender_type":"user"},"body":{"content":"{\"text\":\"乔老板帮我看下发布单\"}"}}
          ],"has_more":false}}' ;;
      *)
        echo 'unexpected chat' >&2; exit 1 ;;
    esac ;;
  /open-apis/im/v1/chats/oc_group/members)
    printf '%s' '{"ok":true,"data":{"items":[{"member_id":"ou_z","name":"张三"},{"member_id":"ou_wang","name":"王五"}],"has_more":false}}' ;;
  *)
    echo "unexpected path $3" >&2; exit 1 ;;
esac
"#,
            )
            .unwrap();
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            let bin = script.to_string_lossy().into_owned();

            let db = test_db();
            let (msgs, cursor) = pull_new_messages(&bin, &db, None).await.unwrap();
            assert!(cursor > 0);
            let find = |id: &str| msgs.iter().find(|m| m.message_id == id).unwrap();
            // 机器人单聊（p2p_target_type=bot）：我→bot 送 AI；bot→我 只作上下文
            let b1 = find("om_b1");
            assert_eq!(b1.chat_type, "bot");
            assert!(b1.is_self && b1.needs_ai, "我发给机器人的要送 AI");
            assert_eq!(b1.sender_name, "乔老板");
            assert_eq!(b1.sent_at, t0, "create_time 毫秒时间戳入库");
            let b2 = find("om_b2");
            assert!(!b2.needs_ai, "机器人的回复只作上下文");
            assert_eq!(b2.sender_name, "皮卡丘助手", "单聊会话名即对方");
            // 好友单聊：对方发的送 AI；我发的只作上下文
            let f1 = find("om_f1");
            assert_eq!(f1.chat_type, "p2p");
            assert!(f1.needs_ai && !f1.is_self, "对方单聊消息送 AI");
            assert_eq!(f1.sender_name, "李四", "单聊会话名即对方");
            let f2 = find("om_f2");
            assert!(!f2.needs_ai, "我自己发的只作上下文");
            assert_eq!(f2.sender_name, "乔老板");
            // 发给自己的会话：我的消息视作备忘送 AI
            let s1 = find("om_s1");
            assert_eq!(s1.chat_type, "p2p");
            assert!(
                s1.is_self && s1.needs_ai,
                "发给自己的会话，我的消息视作备忘送 AI"
            );
            // 免打扰会话整会话跳过，不拉取消息
            assert!(
                msgs.iter().all(|m| m.chat_id != "oc_noisy"),
                "免打扰会话整会话跳过，不拉取消息"
            );
            // 群聊：他人的送 AI（mentions 还原 @我）；我的跳过；应用消息按普通消息送 AI；图片占位但不送 AI
            let g1 = find("om_g1");
            assert_eq!(g1.chat_type, "group");
            assert!(g1.needs_ai);
            assert_eq!(g1.sender_name, "张三", "群成员缓存解析名字");
            assert!(
                g1.content.contains("@我"),
                "mentions 还原成 @我: {}",
                g1.content
            );
            assert_eq!(g1.at_me, "at", "显式 @到我 要带归属标记");
            assert_eq!(
                g1.content_anon, "@我 周会改到周四10点",
                "匿名版 @到我 同样是 @我: {}",
                g1.content_anon
            );
            assert!(!find("om_g2").needs_ai, "群里我自己的消息跳过");
            let g3 = find("om_g3");
            assert!(
                g3.needs_ai,
                "lark-cli 无自建机器人语境，群内应用消息按普通消息处理"
            );
            assert_eq!(g3.sender_name, "应用");
            let g4 = find("om_g4");
            assert!(!g4.needs_ai, "图片消息只作上下文");
            assert_eq!(g4.content, "[图片]");
            // @别人派活的消息：display 保留真名（用户可见），匿名版替换成代号
            let g5 = find("om_g5");
            assert!(g5.needs_ai);
            assert!(
                g5.content.contains("@王五"),
                "他人的提及 display 保留真名: {}",
                g5.content
            );
            assert!(
                g5.content_anon.contains("@成员_"),
                "匿名版他人提及是代号: {}",
                g5.content_anon
            );
            assert!(
                !g5.content_anon.contains("王五"),
                "真名不进匿名版: {}",
                g5.content_anon
            );
            assert_eq!(g5.at_me, "");
            // 手打文本提及我（无 mention 结构）：display 原样，匿名版换疑似@我，归属标记 name
            let g6 = find("om_g6");
            assert!(g6.needs_ai);
            assert_eq!(g6.content, "乔老板帮我看下发布单");
            assert!(
                g6.content_anon.contains("（疑似@我）帮我看下发布单"),
                "{}",
                g6.content_anon
            );
            assert_eq!(g6.at_me, "name", "手打名字命中称呼列表标记为疑似提及");
            // 名字缓存已落库
            let cached: String = {
                let conn = db.0.lock().unwrap();
                conn.query_row(
                    "SELECT name FROM feishu_users WHERE open_id='ou_z'",
                    [],
                    |r| r.get(0),
                )
                .unwrap()
            };
            assert_eq!(cached, "张三");
            // 身份 settings 已落库（pk context 脱敏词源的离线数据源）
            {
                let conn = db.0.lock().unwrap();
                let (oid, name): (String, String) = conn
                    .query_row(
                        "SELECT value FROM settings WHERE key='feishu_my_open_id'",
                        [],
                        |r| r.get(0),
                    )
                    .and_then(|o: String| {
                        conn.query_row(
                            "SELECT value FROM settings WHERE key='feishu_my_name'",
                            [],
                            |r| r.get(0),
                        )
                        .map(|n: String| (o, n))
                    })
                    .unwrap();
                assert_eq!((oid.as_str(), name.as_str()), ("ou_me", "乔老板"));
            }
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    /// 每轮一次全量读：有行解析为覆盖态，无行 = 跟随（Follow 不落库）
    #[test]
    fn load_filter_prefs_reads_all_rows() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO chat_filter_prefs (chat_id, preference, updated_at)
             VALUES ('oc_a','always_filter','t'), ('oc_b','always_pull','t')",
            [],
        )
        .unwrap();
        let prefs = load_filter_prefs(&conn);
        assert_eq!(prefs.get("oc_a"), Some(&FilterPref::AlwaysFilter));
        assert_eq!(prefs.get("oc_b"), Some(&FilterPref::AlwaysPull));
        assert_eq!(prefs.get("oc_ghost"), None, "无偏好行即跟随");
        assert_eq!(prefs.len(), 2);
    }

    /// 快照事务：整表替换 + UPSERT feishu_snapshot_at；零行轮同样清表并推进时间戳
    #[test]
    fn write_chat_snapshot_replaces_table_and_advances_timestamp() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO feishu_chats (chat_id, chat_name, chat_type, mute_outcome)
             VALUES ('oc_old','旧群','group','muted')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('feishu_snapshot_at','2000-01-01T00:00:00Z')",
            [],
        )
        .unwrap();
        write_chat_snapshot(
            &conn,
            &[ChatSnapshotRow {
                chat_id: "oc_a".into(),
                chat_name: "群A".into(),
                chat_type: "group".into(),
                mute_outcome: MuteOutcome::Unknown,
            }],
        )
        .unwrap();
        let rows: Vec<(String, String)> = {
            let mut stmt = conn
                .prepare("SELECT chat_id, mute_outcome FROM feishu_chats ORDER BY chat_id")
                .unwrap();
            stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .collect::<Result<_, _>>()
                .unwrap()
        };
        assert_eq!(rows, vec![("oc_a".into(), "unknown".into())], "整表替换");
        let ts1: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key='feishu_snapshot_at'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_ne!(ts1, "2000-01-01T00:00:00Z", "时间戳推进");

        // 零会话轮：表被清空、时间戳仍推进（两种空态靠该键区分的数据机制）
        std::thread::sleep(std::time::Duration::from_millis(5));
        write_chat_snapshot(&conn, &[]).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM feishu_chats", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "零会话轮清表");
        let ts2: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key='feishu_snapshot_at'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_ne!(ts2, ts1, "零会话轮仍推进时间戳");
    }

    #[test]
    fn short_id_truncates() {
        assert_eq!(short_id("ou_abcdef1234567890"), "ou_abcdef12");
    }

    // ---- 过滤偏好 + 快照集成（feishu-chat-filter，AD §8 测试 2）----

    /// 读快照行的免打扰结果（无行返回 None）
    fn snapshot_outcome(db: &Db, chat_id: &str) -> Option<String> {
        let conn = db.0.lock().unwrap();
        conn.query_row(
            "SELECT mute_outcome FROM feishu_chats WHERE chat_id=?1",
            params![chat_id],
            |r| r.get(0),
        )
        .ok()
    }

    fn snapshot_row_count(db: &Db) -> i64 {
        let conn = db.0.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM feishu_chats", [], |r| r.get(0))
            .unwrap()
    }

    fn snapshot_at(db: &Db) -> Option<String> {
        let conn = db.0.lock().unwrap();
        conn.query_row(
            "SELECT value FROM settings WHERE key='feishu_snapshot_at'",
            [],
            |r| r.get(0),
        )
        .ok()
    }

    /// 假 lark-cli 脚本：chats / batch_query / messages 三段按轮次注入
    #[cfg(unix)]
    fn filter_test_script(
        dir: &std::path::Path,
        name: &str,
        chats_stmt: &str,
        batch_stmt: &str,
        messages_stmt: &str,
    ) -> String {
        let d = dir.join(name);
        std::fs::create_dir_all(&d).unwrap();
        let script = d.join("lark-cli");
        let body = r#"#!/bin/sh
case "$3" in
  /open-apis/authen/v1/user_info)
    printf '%s' '{"ok":true,"data":{"open_id":"ou_me","name":"乔老板"}}' ;;
  /open-apis/im/v1/chats)
__CHATS__ ;;
  /open-apis/im/v1/chat_user_setting/batch_query)
__BATCH__ ;;
  /open-apis/im/v1/messages)
__MESSAGES__ ;;
  /open-apis/im/v1/chats/*/members)
    printf '%s' '{"ok":true,"data":{"items":[],"has_more":false}}' ;;
  *)
    echo "unexpected path $3" >&2; exit 1 ;;
esac
"#
        .replace("__CHATS__", chats_stmt)
        .replace("__BATCH__", batch_stmt)
        .replace("__MESSAGES__", messages_stmt);
        std::fs::write(&script, body).unwrap();
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        script.to_string_lossy().into_owned()
    }

    /// 三态偏好 × 免打扰三值态的拉取行为 + 快照落库（含分批部分失败、孤儿沉睡复活、零会话轮）。
    /// 批次划分：前 10 个会话一批（成功），第 11 个 oc_flaky 单独成批（脚本按请求体选择性失败）。
    #[cfg(unix)]
    #[test]
    fn pull_new_messages_applies_filter_prefs_and_snapshot() {
        tauri::async_runtime::block_on(async {
            let dir = std::env::temp_dir().join(format!("pk-lark-filter-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();

            // 偏好：oc_vip 总是拉取（被免打扰误杀要拯救）、oc_noise 总是过滤、
            // oc_orphan 总是过滤（孤儿：不在第 1 轮会话列表，第 2 轮复活）
            let db = test_db();
            {
                let conn = db.0.lock().unwrap();
                conn.execute(
                    "INSERT INTO chat_filter_prefs (chat_id, preference, updated_at)
                     VALUES ('oc_vip','always_pull','2026-09-23T00:00:00Z'),
                            ('oc_noise','always_filter','2026-09-23T00:00:00Z'),
                            ('oc_orphan','always_filter','2026-09-23T00:00:00Z')",
                    [],
                )
                .unwrap();
            }

            // 第 1 轮：11 个会话（前 10 一批成功，oc_flaky 批次失败）
            let r1 = filter_test_script(
                &dir,
                "round1",
                r#"    printf '%s' '{"ok":true,"data":{"items":[
        {"chat_id":"oc_vip","name":"重要项目群","chat_mode":"group"},
        {"chat_id":"oc_noise","name":"灌水群","chat_mode":"group"},
        {"chat_id":"oc_missing","name":"缺项群","chat_mode":"group"},
        {"chat_id":"oc_muted_follow","name":"免打扰跟随群","chat_mode":"group"},
        {"chat_id":"oc_f1","name":"填1","chat_mode":"group"},
        {"chat_id":"oc_f2","name":"填2","chat_mode":"group"},
        {"chat_id":"oc_f3","name":"填3","chat_mode":"group"},
        {"chat_id":"oc_f4","name":"填4","chat_mode":"group"},
        {"chat_id":"oc_f5","name":"填5","chat_mode":"group"},
        {"chat_id":"oc_f6","name":"填6","chat_mode":"group"},
        {"chat_id":"oc_flaky","name":"失败批群","chat_mode":"group"}
      ],"has_more":false}}'"#,
                // 批 1 成功但 items 缺 oc_missing（→ Unmuted）；oc_flaky 所在批整体失败（→ Unknown）
                r#"    case "$5" in
      *oc_flaky*)
        echo 'batch query boom' >&2; exit 1 ;;
      *)
        printf '%s' '{"ok":true,"data":{"items":[
            {"chat_id":"oc_vip","is_muted":true},
            {"chat_id":"oc_noise","is_muted":false},
            {"chat_id":"oc_muted_follow","is_muted":true},
            {"chat_id":"oc_f1","is_muted":true},
            {"chat_id":"oc_f2","is_muted":true},
            {"chat_id":"oc_f3","is_muted":true},
            {"chat_id":"oc_f4","is_muted":true},
            {"chat_id":"oc_f5","is_muted":true},
            {"chat_id":"oc_f6","is_muted":true}
        ]}}' ;;
    esac"#,
                // 只有幸存会话会被分页：oc_vip（手动拉取）、oc_missing（缺项→未免打扰）、
                // oc_flaky（批次失败降级拉取）；被过滤会话一旦被拉取会让脚本报错、测试失败
                r#"    case "$5" in
      *'"container_id":"oc_vip"'*)
        printf '%s' '{"ok":true,"data":{"items":[{"message_id":"om_vip","msg_type":"text","create_time":"1789200000000","sender":{"id":"ou_x","sender_type":"user"},"body":{"content":"{\"text\":\"被拯救的重要消息\"}"}}],"has_more":false}}' ;;
      *'"container_id":"oc_missing"'*)
        printf '%s' '{"ok":true,"data":{"items":[{"message_id":"om_missing","msg_type":"text","create_time":"1789200000000","sender":{"id":"ou_x","sender_type":"user"},"body":{"content":"{\"text\":\"缺项群消息\"}"}}],"has_more":false}}' ;;
      *'"container_id":"oc_flaky"'*)
        printf '%s' '{"ok":true,"data":{"items":[{"message_id":"om_flaky","msg_type":"text","create_time":"1789200000000","sender":{"id":"ou_x","sender_type":"user"},"body":{"content":"{\"text\":\"降级仍拉取\"}"}}],"has_more":false}}' ;;
      *)
        echo 'unexpected chat' >&2; exit 1 ;;
    esac"#,
            );
            let (msgs, _) = pull_new_messages(&r1, &db, None).await.unwrap();
            let pulled: Vec<&str> = msgs.iter().map(|m| m.message_id.as_str()).collect();
            assert_eq!(
                pulled,
                vec!["om_vip", "om_missing", "om_flaky"],
                "① 免打扰×always_pull 被拉取；⑥ 缺项=未免打扰被拉取；③ 失败批降级被拉取"
            );
            // ② 未免打扰×always_filter 整会话跳过（脚本对未预期会话直接失败，能走到这里即证明）
            // ④ 快照含全部 11 个会话（含被过滤者）且时间戳键已写入
            assert_eq!(snapshot_row_count(&db), 11);
            assert!(snapshot_at(&db).is_some(), "feishu_snapshot_at 已写入");
            assert_eq!(snapshot_outcome(&db, "oc_vip").as_deref(), Some("muted"));
            assert_eq!(
                snapshot_outcome(&db, "oc_noise").as_deref(),
                Some("unmuted")
            );
            assert_eq!(
                snapshot_outcome(&db, "oc_missing").as_deref(),
                Some("unmuted"),
                "⑥ 批次成功但 items 缺项 → unmuted"
            );
            assert_eq!(
                snapshot_outcome(&db, "oc_muted_follow").as_deref(),
                Some("muted")
            );
            assert_eq!(
                snapshot_outcome(&db, "oc_flaky").as_deref(),
                Some("unknown"),
                "③ 失败批会话标 unknown"
            );
            assert!(
                snapshot_outcome(&db, "oc_orphan").is_none(),
                "⑦ 孤儿偏好不在会话列表 → 快照无其行"
            );

            // 第 2 轮（⑦ 孤儿复活）：会话列表只含 oc_orphan，沉睡偏好立即生效（仍被过滤）
            let r2 = filter_test_script(
                &dir,
                "round2",
                r#"    printf '%s' '{"ok":true,"data":{"items":[
        {"chat_id":"oc_orphan","name":"旧项目群","chat_mode":"group"}
      ],"has_more":false}}'"#,
                r#"    printf '%s' '{"ok":true,"data":{"items":[]}}'"#,
                r#"    echo 'unexpected chat' >&2; exit 1"#,
            );
            let (msgs2, _) = pull_new_messages(&r2, &db, None).await.unwrap();
            assert!(
                msgs2.is_empty(),
                "⑦ 复活后偏好立即生效：always_filter 不拉任何消息（拉了脚本会报错）"
            );
            assert_eq!(snapshot_row_count(&db), 1, "快照整表替换为本轮会话");
            assert_eq!(
                snapshot_outcome(&db, "oc_orphan").as_deref(),
                Some("unmuted"),
                "⑦ 复活会话进快照"
            );
            let orphan_pref: i64 = {
                let conn = db.0.lock().unwrap();
                conn.query_row(
                    "SELECT COUNT(*) FROM chat_filter_prefs WHERE chat_id='oc_orphan'",
                    [],
                    |r| r.get(0),
                )
                .unwrap()
            };
            assert_eq!(orphan_pref, 1, "偏好行沉睡期不被删除");

            // 第 3 轮（⑧ 零会话成功轮）：表被清空、时间戳仍推进
            let ts_before = snapshot_at(&db).unwrap();
            let r3 = filter_test_script(
                &dir,
                "round3",
                r#"    printf '%s' '{"ok":true,"data":{"items":[],"has_more":false}}'"#,
                r#"    printf '%s' '{"ok":true,"data":{"items":[]}}'"#,
                r#"    echo 'unexpected chat' >&2; exit 1"#,
            );
            let (msgs3, _) = pull_new_messages(&r3, &db, None).await.unwrap();
            assert!(msgs3.is_empty());
            assert_eq!(snapshot_row_count(&db), 0, "⑧ 零会话轮清空快照表");
            let ts_after = snapshot_at(&db).unwrap();
            assert!(ts_after != ts_before, "⑧ 零会话轮仍推进 feishu_snapshot_at");

            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    /// 拉取 in-flight 守卫（AD §8 测试 6）：并发二次进入立即返回冲突错误、
    /// 不产生第二次 lark-cli 子进程调用（脚本内计数器断言）；
    /// 错误路径与成功路径都释放守卫（之后仍可正常触发）。
    #[cfg(unix)]
    #[test]
    fn poll_once_in_flight_guard_rejects_reentry_and_releases() {
        tauri::async_runtime::block_on(async {
            let dir = std::env::temp_dir().join(format!("pk-lark-guard-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let counter = dir.join("calls");

            let app = tauri::test::mock_app();
            app.manage(Db(Mutex::new(test_conn())));
            app.manage(crate::health::HealthState::default());

            // 未配置 AI agent 的错误路径也必须释放守卫：两次都是配置错误而非冲突
            {
                let e1 = poll_once(app.handle()).await.unwrap_err();
                assert!(e1.to_string().contains("AI Agent"), "{e1}");
                let e2 = poll_once(app.handle()).await.unwrap_err();
                assert!(
                    e2.to_string().contains("AI Agent"),
                    "错误路径释放守卫（第二次不是冲突错误）: {e2}"
                );
            }

            // 配置 agent + 假 lark-cli：每次调用计数一行；user_info 睡 1s 拉长在飞窗口
            {
                let db = app.state::<Db>();
                let conn = db.0.lock().unwrap();
                conn.execute(
                    "INSERT INTO settings (key, value) VALUES ('ai_agents', ?1)",
                    params![serde_json::to_string(&[crate::ai::AgentConfig {
                        id: "fake".into(),
                        name: "Fake".into(),
                        command: "claude".into(),
                        timeout_secs: 10,
                        ..Default::default()
                    }])
                    .unwrap()],
                )
                .unwrap();
            }
            let script = dir.join("lark-cli");
            std::fs::write(
                &script,
                format!(
                    r#"#!/bin/sh
COUNTER='{}'
case "$3" in
  /open-apis/authen/v1/user_info)
    echo x >> "$COUNTER"; sleep 1
    printf '%s' '{{"ok":true,"data":{{"open_id":"ou_me","name":"乔老板"}}}}' ;;
  /open-apis/im/v1/chats)
    echo x >> "$COUNTER"
    printf '%s' '{{"ok":true,"data":{{"items":[],"has_more":false}}}}' ;;
  /open-apis/im/v1/chat_user_setting/batch_query)
    printf '%s' '{{"ok":true,"data":{{"items":[]}}}}' ;;
  *)
    echo "unexpected path $3" >&2; exit 1 ;;
esac
"#,
                    counter.to_string_lossy()
                ),
            )
            .unwrap();
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            std::env::set_var("LARK_CLI_BIN", &script);
            let calls = || -> usize {
                std::fs::read_to_string(&counter)
                    .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
                    .unwrap_or(0)
            };

            // 首轮后台慢跑；等到 user_info 已发起（计数 ≥ 1）
            let h1 = app.handle().clone();
            let first = tauri::async_runtime::spawn(async move { poll_once(&h1).await });
            let mut waited_ms = 0u32;
            while calls() < 1 {
                tokio::time::sleep(Duration::from_millis(50)).await;
                waited_ms += 50;
                assert!(waited_ms < 15_000, "首轮迟迟未发起 lark-cli 调用");
            }
            // 二次进入：立即返回冲突错误，且子进程调用不翻倍（计数仍为 1）
            let e = poll_once(app.handle()).await.unwrap_err();
            assert!(
                e.to_string().contains("进行中"),
                "占用期间再触发返回冲突错误: {e}"
            );
            assert_eq!(calls(), 1, "不产生第二次 lark-cli 子进程调用");

            // 首轮完成（零会话成功轮）：user_info + chats 共 2 次调用
            let n = first.await.unwrap().unwrap();
            assert_eq!(n, 0);
            assert_eq!(calls(), 2);

            // 守卫已释放：再次触发正常执行（又一轮 2 次调用）
            let n2 = poll_once(app.handle()).await.unwrap();
            assert_eq!(n2, 0);
            assert_eq!(calls(), 4, "释放后可再次执行");

            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    // ---- 会话过滤决策（feishu-chat-filter）----

    /// 3 preference × 3 outcome 全组合（AD §8 测试 1；断言值 = plan 速览表）
    #[test]
    fn filter_decision_covers_pref_x_outcome_matrix() {
        use FilterEffect as E;
        use FilterPref as P;
        use FilterSource as S;
        let cases: [(FilterPref, MuteOutcome, (FilterEffect, FilterSource), &str); 9] = [
            (
                P::AlwaysFilter,
                MuteOutcome::Muted,
                (E::Filter, S::Manual),
                "手动总是过滤不受免打扰影响",
            ),
            (
                P::AlwaysFilter,
                MuteOutcome::Unmuted,
                (E::Filter, S::Manual),
                "未免打扰的噪音会话也被过滤",
            ),
            (
                P::AlwaysFilter,
                MuteOutcome::Unknown,
                (E::Filter, S::Manual),
                "查询失败不影响手动覆盖",
            ),
            (
                P::AlwaysPull,
                MuteOutcome::Muted,
                (E::Pull, S::Manual),
                "被免打扰误杀的会话手动拯救",
            ),
            (
                P::AlwaysPull,
                MuteOutcome::Unmuted,
                (E::Pull, S::Manual),
                "总是拉取",
            ),
            (
                P::AlwaysPull,
                MuteOutcome::Unknown,
                (E::Pull, S::Manual),
                "查询失败不影响手动覆盖",
            ),
            (
                P::Follow,
                MuteOutcome::Muted,
                (E::Filter, S::Follow),
                "跟随：免打扰→过滤",
            ),
            (
                P::Follow,
                MuteOutcome::Unmuted,
                (E::Pull, S::Follow),
                "跟随：未免打扰→拉取",
            ),
            (
                P::Follow,
                MuteOutcome::Unknown,
                (E::Pull, S::FollowDegraded),
                "跟随：批次失败→降级拉取（独立来源值）",
            ),
        ];
        for (pref, outcome, want, why) in cases {
            assert_eq!(filter_decision(pref, outcome), want, "{why}");
        }
    }

    /// 枚举字面值是跨层契约（SQL CHECK / command 出参 / 前端 types.ts），
    /// followDegraded 尤其容易写成 kebab-case
    #[test]
    fn filter_enum_str_values_match_contract() {
        assert_eq!(FilterPref::Follow.as_str(), "follow");
        assert_eq!(FilterPref::AlwaysFilter.as_str(), "always_filter");
        assert_eq!(FilterPref::AlwaysPull.as_str(), "always_pull");
        assert_eq!(
            FilterPref::parse("always_pull"),
            Some(FilterPref::AlwaysPull)
        );
        assert_eq!(FilterPref::parse("follow"), Some(FilterPref::Follow));
        assert_eq!(FilterPref::parse("Follow"), None, "封闭枚举不容变体");
        assert_eq!(MuteOutcome::Muted.as_str(), "muted");
        assert_eq!(MuteOutcome::Unmuted.as_str(), "unmuted");
        assert_eq!(MuteOutcome::Unknown.as_str(), "unknown");
        assert_eq!(MuteOutcome::parse("unmuted"), MuteOutcome::Unmuted);
        assert_eq!(
            MuteOutcome::parse("bogus"),
            MuteOutcome::Unknown,
            "坏数据按 unknown 兜底"
        );
        assert_eq!(FilterEffect::Pull.as_str(), "pull");
        assert_eq!(FilterEffect::Filter.as_str(), "filter");
        assert_eq!(FilterSource::Manual.as_str(), "manual");
        assert_eq!(FilterSource::Follow.as_str(), "follow");
        assert_eq!(FilterSource::FollowDegraded.as_str(), "followDegraded");
    }
}
