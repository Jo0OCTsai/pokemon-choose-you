//! 飞书消息拉取与语境判定：用户身份与凭证由官方 lark-cli 保管（子进程封装见 lark_cli.rs），
//! 这里负责会话/消息的聚合翻页、谁的消息送 AI 的语境规则、入库与 AI 分发。
use crate::ai::{self, AiMessage};
use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::events;
use rusqlite::params;
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

/// 批量查询会话免打扰状态（折叠状态开放平台未暴露，免打扰是最接近的可见信号，
/// 折叠的噪音会话通常也被设为免打扰）。查询失败降级为空集合，不阻断拉取。
async fn muted_chat_ids(bin: &str, chat_ids: &[String]) -> HashSet<String> {
    let mut out = HashSet::new();
    for chunk in chat_ids.chunks(10) {
        let items = match crate::lark_cli::chat_user_settings(bin, chunk).await {
            Ok(d) => d["items"].as_array().cloned(),
            Err(e) => {
                log::warn!("feishu: lark-cli 查询免打扰状态失败（跳过过滤）: {e}");
                None
            }
        };
        for item in items.unwrap_or_default() {
            if item["is_muted"].as_bool() == Some(true) {
                if let Some(id) = item["chat_id"].as_str() {
                    out.insert(id.to_string());
                }
            }
        }
    }
    out
}

#[derive(Default)]
struct MsgPage {
    items: Option<Vec<serde_json::Value>>,
    has_more: bool,
    page_token: Option<String>,
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

/// 把消息 body.content 渲染成可读文本。
/// text/post/卡片保留语义结构（@人名、链接），媒体类给占位符，无法理解的返回 None 跳过。
/// mentions：消息级 @ 映射（key "@_user_1" → name/open_id），text 占位符与 post 的 user_key 都靠它还原人名。
/// my_open_id：授权用户自己的 open_id——@到我 的提及渲染成「@我」而非真名，
/// 让 AI 能把「给我的任务」和「@别人的任务」区分开。
fn render_content(
    msg_type: &str,
    content: &str,
    mentions: &serde_json::Value,
    my_open_id: &str,
    resolve_name: &dyn Fn(&str) -> Option<String>,
) -> Option<String> {
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
    match msg_type {
        "text" => {
            let mut text = v["text"].as_str()?.to_string();
            if let Some(arr) = mentions.as_array() {
                for m in arr {
                    if let Some(key) = m["key"].as_str() {
                        let name = if m["id"]["open_id"].as_str() == Some(my_open_id)
                            && !my_open_id.is_empty()
                        {
                            "我".to_string()
                        } else {
                            m["name"]
                                .as_str()
                                .map(String::from)
                                .or_else(|| m["id"]["open_id"].as_str().and_then(resolve_name))
                                .unwrap_or_else(|| "成员".into())
                        };
                        text = text.replace(key, &format!("@{name}"));
                    }
                }
            }
            Some(text)
        }
        "post" => {
            // 富文本可能按语言分包（zh_cn/en_us/...），取第一个语言包，否则整体即内容
            let body = ["zh_cn", "en_us", "ja_jp"]
                .iter()
                .find_map(|k| v[k].as_object().map(|_| &v[k]))
                .unwrap_or(&v);
            let mut out = String::new();
            if let Some(title) = body["title"].as_str().filter(|s| !s.is_empty()) {
                out.push_str(&format!("{title}\n"));
            }
            let paragraphs = body["content"].as_array()?;
            let mut lines = vec![];
            for para in paragraphs {
                let mut line = vec![];
                if let Some(segs) = para.as_array() {
                    for seg in segs {
                        line.push(render_post_segment(seg, &mention_name, resolve_name));
                    }
                }
                let joined: String = line
                    .into_iter()
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join(" ");
                lines.push(joined);
            }
            out.push_str(&lines.join("\n"));
            Some(out)
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
                Some(format!("[卡片] {s}"))
            }
        }
        "image" => Some("[图片]".into()),
        "audio" => Some("[语音]".into()),
        "media" => Some("[视频]".into()),
        "file" => {
            let name = v["file_name"].as_str().unwrap_or_default();
            Some(if name.is_empty() {
                "[文件]".into()
            } else {
                format!("[文件:{name}]")
            })
        }
        "sticker" => Some("[表情]".into()),
        "share_chat" => Some("[群名片]".into()),
        "share_user" => Some("[个人名片]".into()),
        "merged_forward" => Some("[合并转发]".into()),
        _ => None,
    }
}

/// post 富文本的单个元素 → 文本（@人、链接带 href，媒体给占位符）
fn render_post_segment(
    seg: &serde_json::Value,
    mention_name: &dyn Fn(&str) -> Option<String>,
    resolve_name: &dyn Fn(&str) -> Option<String>,
) -> String {
    let tag = seg["tag"].as_str().unwrap_or_default();
    match tag {
        "text" => seg["text"].as_str().unwrap_or_default().to_string(),
        "a" => {
            let text = seg["text"].as_str().unwrap_or_default();
            match seg["href"].as_str().filter(|h| !h.is_empty()) {
                Some(href) => format!("{text}({href})"),
                None => text.to_string(),
            }
        }
        "at" => {
            let name = seg["user_key"]
                .as_str()
                .and_then(mention_name)
                .or_else(|| {
                    seg["user_id"]
                        .as_str()
                        .or_else(|| seg["open_id"].as_str())
                        .and_then(resolve_name)
                })
                .unwrap_or_else(|| "成员".into());
            format!("@{name}")
        }
        "img" => "[图片]".into(),
        "media" => "[视频]".into(),
        "emotion" => "[表情]".into(),
        _ => String::new(),
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
    let mut chats = chats(bin).await?;
    if chats.is_empty() {
        log::info!("feishu: 授权用户不在任何会话中，无消息可拉取");
    }
    // 免打扰会话（≈折叠的噪音源）不拉取：查询失败降级为不过滤
    let chat_ids: Vec<String> = chats.iter().map(|c| c.chat_id.clone()).collect();
    let muted = muted_chat_ids(bin, &chat_ids).await;
    if !muted.is_empty() {
        chats.retain(|c| !muted.contains(&c.chat_id));
        log::debug!("feishu: 跳过 {} 个免打扰会话", muted.len());
    }
    let mut names = cached_names(db);
    let mut refreshed_chats: HashSet<String> = HashSet::new();

    let now_ms = chrono::Utc::now().timestamp_millis();
    let (start_s, end_s) = window_secs(since_ms, now_ms);
    let mut out = vec![];
    for chat in &chats {
        let chat_is_bot = chat.chat_mode == "p2p" && chat.p2p_target_type.as_deref() == Some("bot");
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
                let Some(text) = render_content(msg_type, content, mentions, &my_open_id, &resolve)
                else {
                    continue;
                };
                if text.trim().is_empty() {
                    continue;
                }
                let is_self = sender_type == "user" && sender_id == my_open_id;
                let chat_type = if chat_is_bot {
                    "bot"
                } else if chat.chat_mode == "p2p" {
                    "p2p"
                } else {
                    "group"
                };
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
                    "feishu: 新消息「{chat_type}·{}」{sender_name}: {text}",
                    chat.name
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
                    content: text,
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

/// 一轮完整的"拉取 → 全量入库（待判定/仅上下文）→ AI 分类（带判重与同会话上下文）
/// → 更新消息状态 → 清理过期消息"。外层同时登记飞书链路健康（成功/失败）。
pub async fn poll_once(app: &AppHandle) -> AppResult<usize> {
    let result = poll_once_inner(app).await;
    let state = app.state::<crate::health::HealthState>();
    match &result {
        Ok(_) => state.record_success(app, crate::health::FEISHU),
        Err(e) => state.record_failure(app, crate::health::FEISHU, &e.to_string()),
    }
    result
}

async fn poll_once_inner(app: &AppHandle) -> AppResult<usize> {
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
                                            content, sent_at, is_self, ai_status, review_status, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'pending',?11)",
                params![
                    m.message_id,
                    m.chat_id,
                    m.chat_name,
                    m.chat_type,
                    m.sender_name,
                    m.sender_id,
                    m.content,
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

    // 2. 分批送 AI（每批 20 条，避免超 token），带判重上下文与同会话近期消息
    let actionable: Vec<&NewMessage> = fresh.iter().filter(|m| m.needs_ai).collect();
    let mut saved = 0usize;
    for chunk in actionable.chunks(20) {
        let batch = {
            let conn = db.0.lock().unwrap();
            chunk
                .iter()
                .map(|m| AiMessage {
                    message_id: m.message_id.clone(),
                    sender: m.sender_name.clone(),
                    chat_label: crate::commands::radio::chat_label(&m.chat_type, &m.chat_name),
                    content: m.content.clone(),
                    context: crate::commands::radio::chat_context_lines(
                        &conn,
                        &m.chat_id,
                        m.sent_at,
                        &m.message_id,
                        CONTEXT_WINDOW_MS,
                        CONTEXT_MAX_MESSAGES,
                    ),
                })
                .collect::<Vec<_>>()
        };
        let ctx = {
            let conn = db.0.lock().unwrap();
            crate::commands::radio::classify_context(&conn)?
        };
        // 分类调用按次落 agent_sessions（会话回链与成本观察：时长 / 会话 id / 成败）
        let started = std::time::Instant::now();
        let classified = ai::classify_with_session(&agent, &batch, &ctx, &db).await;
        let duration_ms = started.elapsed().as_millis() as i64;
        let suggestions = match classified {
            Ok((s, session_id)) => {
                let conn = db.0.lock().unwrap();
                let _ = crate::commands::sessions::log_session_conn(
                    &conn,
                    &crate::commands::sessions::NewAgentSession {
                        task_id: None,
                        agent_id: agent.id.clone(),
                        session_id,
                        command: None,
                        exit_code: Some(0),
                        status: "ok".into(),
                        duration_ms: Some(duration_ms),
                        cost_usd: None,
                        input_tokens: None,
                        output_tokens: None,
                    },
                );
                s
            }
            Err(e) => {
                log::warn!("AI 分类失败（本轮跳过）: {e}");
                app.state::<crate::health::HealthState>().record_failure(
                    app,
                    crate::health::AI,
                    &e.to_string(),
                );
                let conn = db.0.lock().unwrap();
                let _ = crate::commands::sessions::log_session_conn(
                    &conn,
                    &crate::commands::sessions::NewAgentSession {
                        task_id: None,
                        agent_id: agent.id.clone(),
                        session_id: None,
                        command: None,
                        exit_code: None,
                        status: "error".into(),
                        duration_ms: Some(duration_ms),
                        cost_usd: None,
                        input_tokens: None,
                        output_tokens: None,
                    },
                );
                for m in chunk {
                    let _ = conn.execute(
                        "UPDATE chat_messages SET ai_status='error' WHERE message_id=?1",
                        params![m.message_id],
                    );
                }
                continue;
            }
        };
        app.state::<crate::health::HealthState>()
            .record_success(app, crate::health::AI);
        let n_todo = suggestions.iter().filter(|s| s.is_todo()).count();
        let n_update = suggestions.iter().filter(|s| s.is_update()).count();
        let n_follow = suggestions.iter().filter(|s| s.is_follow_up()).count();
        log::info!(
            "feishu: AI 判定 {}/{} 条：新待办 {n_todo} · 变更建议 {n_update} · 跟进 {n_follow}",
            n_todo + n_update + n_follow,
            batch.len()
        );
        let by_id: HashMap<String, &ai::AiSuggestion> = suggestions
            .iter()
            .map(|s| (s.message_id.clone(), s))
            .collect();
        let conn = db.0.lock().unwrap();
        for m in chunk {
            // 未被提及的消息按 none 记状态（AI 没给判定不等于跳过）
            let fallback;
            let s: &ai::AiSuggestion = match by_id.get(&m.message_id) {
                Some(s) => s,
                None => {
                    fallback = ai::AiSuggestion {
                        message_id: m.message_id.clone(),
                        ..Default::default()
                    };
                    &fallback
                }
            };
            if s.is_todo() {
                log::info!(
                    "feishu: 新待办「{}」分类 {} 优先级 {} due {:?} 标签 {:?}（消息 {}）",
                    s.title.as_deref().unwrap_or("-"),
                    s.category.as_deref().unwrap_or("-"),
                    s.priority.as_deref().unwrap_or("-"),
                    s.due,
                    s.tags,
                    s.message_id
                );
            } else if s.is_update() {
                // AI 判定是对现有待办的变更（改期/改优先级等）：
                // 落成「更新建议」卡，用户在收音机确认后才应用
                log::info!(
                    "feishu: 消息 {} 判定为待办 {} 的变更建议（待确认）",
                    m.message_id,
                    s.update_task_id.unwrap_or(0)
                );
            } else if s.is_follow_up() {
                // AI 判定是对现有待办的跟进：直接挂跟进记录，不建新待办
                log::info!(
                    "feishu: 消息 {} 判定为待办 {} 的跟进，已记录",
                    m.message_id,
                    s.follow_up_task_id.unwrap_or(0)
                );
            }
            crate::commands::radio::apply_suggestion_conn(&conn, s, &agent.id)?;
            if s.is_todo() {
                saved += 1;
            }
        }
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

    #[test]
    fn render_text_message_with_mentions() {
        let content = r#"{"text":"@_user_1 看一下这个"}"#;
        let mentions = serde_json::json!([
            {"key": "@_user_1", "name": "张三", "id": {"open_id": "ou_z"}}
        ]);
        assert_eq!(
            render_content("text", content, &mentions, "", &|_| None).as_deref(),
            Some("@张三 看一下这个")
        );
        // @到我 的提及渲染成「@我」（即使 name 字段是真名），AI 才能区分任务归属
        let to_me = serde_json::json!([
            {"key": "@_user_1", "name": "本大爷", "id": {"open_id": "ou_me"}}
        ]);
        assert_eq!(
            render_content("text", content, &to_me, "ou_me", &|_| None).as_deref(),
            Some("@我 看一下这个")
        );
        // 无 mentions 映射时保留原文
        assert_eq!(
            render_content("text", content, &serde_json::Value::Null, "", &|_| None).as_deref(),
            Some("@_user_1 看一下这个")
        );
    }

    #[test]
    fn render_post_rich_text_with_at_link_and_media() {
        let content = r#"{"title":"纪要","content":[[
            {"tag":"text","text":"周三前"},
            {"tag":"at","user_id":"ou_z"},
            {"tag":"a","text":"需求文档","href":"https://doc.example/x"},
            {"tag":"img","image_key":"k"}
        ]]}"#;
        let out = render_content("post", content, &serde_json::Value::Null, "", &|id| {
            (id == "ou_z").then(|| "张三".to_string())
        })
        .unwrap();
        assert!(out.starts_with("纪要\n"), "标题单独成行: {out}");
        assert!(out.contains("周三前"));
        assert!(out.contains("@张三"), "at 段解析成 @人名: {out}");
        assert!(
            out.contains("需求文档(https://doc.example/x)"),
            "链接带 href: {out}"
        );
        assert!(out.contains("[图片]"), "图片给占位符: {out}");
    }

    #[test]
    fn render_post_localized_pack_and_media_placeholders() {
        // 语言包形态：取 zh_cn
        let content = r#"{"title":"外层","zh_cn":{"title":"中文标题","content":[[{"tag":"text","text":"你好"}]]}}"#;
        assert_eq!(
            render_content("post", content, &serde_json::Value::Null, "", &|_| None).as_deref(),
            Some("中文标题\n你好")
        );
        assert_eq!(
            render_content(
                "image",
                r#"{"image_key":"k"}"#,
                &serde_json::Value::Null,
                "",
                &|_| None
            )
            .as_deref(),
            Some("[图片]")
        );
        assert_eq!(
            render_content(
                "file",
                r#"{"file_name":"合同.pdf"}"#,
                &serde_json::Value::Null,
                "",
                &|_| None
            )
            .as_deref(),
            Some("[文件:合同.pdf]")
        );
        assert_eq!(
            render_content("audio", "{}", &serde_json::Value::Null, "", &|_| None).as_deref(),
            Some("[语音]")
        );
    }

    #[test]
    fn render_interactive_card_collects_text() {
        let content = r#"{"header":{"title":{"content":"审批提醒"}},"elements":[{"tag":"div","text":{"text":"张三提交了请假申请"}}]}"#;
        let out = render_content(
            "interactive",
            content,
            &serde_json::Value::Null,
            "",
            &|_| None,
        )
        .unwrap();
        assert!(out.starts_with("[卡片]"));
        assert!(
            out.contains("审批提醒") && out.contains("请假申请"),
            "{out}"
        );
    }

    #[test]
    fn render_unknown_and_invalid_returns_none() {
        assert_eq!(
            render_content("system", "{}", &serde_json::Value::Null, "", &|_| None),
            None,
            "系统消息跳过"
        );
        assert_eq!(
            render_content("text", "not-json", &serde_json::Value::Null, "", &|_| None),
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
    printf '%s' '{"ok":true,"data":{"open_id":"ou_me","name":"我"}}' ;;
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
            {"message_id":"om_g5","msg_type":"text","create_time":"1789200004000","sender":{"id":"ou_z","sender_type":"user"},"body":{"content":"{\"text\":\"@_user_2 你来写周报\"}"},"mentions":[{"key":"@_user_2","name":"王五","id":{"open_id":"ou_wang"}}]}
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
            assert_eq!(b1.sender_name, "我");
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
            assert_eq!(f2.sender_name, "我");
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
            // @别人派活的消息：提及保留真名，AI 才能判定这是别人的任务
            let g5 = find("om_g5");
            assert!(g5.needs_ai);
            assert!(
                g5.content.contains("@王五"),
                "他人的提及保留真名: {}",
                g5.content
            );
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
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    #[test]
    fn short_id_truncates() {
        assert_eq!(short_id("ou_abcdef1234567890"), "ou_abcdef12");
    }
}
