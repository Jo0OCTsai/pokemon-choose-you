use crate::ai::{self, AgentConfig, AiMessage, ClassifyContext};
use crate::commands::tasks::{update_task, TaskPatch};
use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::models::ChatMessage;
use chrono::TimeZone;
use rusqlite::{params, Connection};
use tauri::State;

const MSG_COLS: &str = "id, message_id, chat_id, chat_name, chat_type, sender, sender_id, sent_at, is_self, content, \
                        suggested_title, suggested_category, suggested_due, suggested_priority, suggested_note, suggested_tags, \
                        ai_status, review_status, task_id, update_task_id, created_at";

fn row_to_message(row: &rusqlite::Row) -> rusqlite::Result<ChatMessage> {
    let tags_raw: String = row.get(15)?;
    Ok(ChatMessage {
        id: row.get(0)?,
        message_id: row.get(1)?,
        chat_id: row.get(2)?,
        chat_name: row.get(3)?,
        chat_type: row.get(4)?,
        sender: row.get(5)?,
        sender_id: row.get(6)?,
        sent_at: row.get(7)?,
        is_self: row.get::<_, i64>(8)? != 0,
        content: row.get(9)?,
        suggested_title: row.get(10)?,
        suggested_category: row.get(11)?,
        suggested_due: row.get(12)?,
        suggested_priority: row.get(13)?,
        suggested_note: row.get(14)?,
        suggested_tags: serde_json::from_str(&tags_raw).unwrap_or_default(),
        ai_status: row.get(16)?,
        review_status: row.get(17)?,
        task_id: row.get(18)?,
        update_task_id: row.get(19)?,
        created_at: row.get(20)?,
    })
}

/// 收音机电波列表：展示送过 AI 判定的消息（skipped 的仅作上下文，不进列表），可按关键词过滤
#[tauri::command]
pub fn list_chat_messages(db: State<Db>, query: Option<String>) -> AppResult<Vec<ChatMessage>> {
    let conn = db.0.lock().unwrap();
    let q = query.unwrap_or_default().trim().to_string();
    let rows = if q.is_empty() {
        let mut stmt = conn.prepare(&format!(
            "SELECT {MSG_COLS} FROM chat_messages WHERE ai_status != 'skipped' ORDER BY id DESC LIMIT 300"
        ))?;
        let rows = stmt
            .query_map([], row_to_message)?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    } else {
        let like = format!(
            "%{}%",
            q.replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_")
        );
        let mut stmt = conn.prepare(&format!(
            "SELECT {MSG_COLS} FROM chat_messages
             WHERE ai_status != 'skipped'
               AND (content LIKE ?1 ESCAPE '\\' OR chat_name LIKE ?1 ESCAPE '\\' OR sender LIKE ?1 ESCAPE '\\'
                    OR suggested_title LIKE ?1 ESCAPE '\\')
             ORDER BY id DESC LIMIT 300"
        ))?;
        let rows = stmt
            .query_map(params![like], row_to_message)?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    Ok(rows)
}

fn get_message(conn: &Connection, id: i64) -> AppResult<ChatMessage> {
    conn.query_row(
        &format!("SELECT {MSG_COLS} FROM chat_messages WHERE id=?1"),
        params![id],
        row_to_message,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("消息 {id} 不存在")),
        other => AppError::Db(other),
    })
}

/// 标签名 → 标签 id（只认已配置的标签，未知名静默丢弃）
fn resolve_tag_ids(conn: &Connection, names: &[String]) -> AppResult<Vec<i64>> {
    let mut ids = vec![];
    let mut stmt = conn.prepare("SELECT id FROM tags WHERE name=?1")?;
    for name in names {
        if let Ok(id) = stmt.query_row(params![name], |r| r.get::<_, i64>(0)) {
            ids.push(id);
        }
    }
    Ok(ids)
}

/// 分类名 → 分类 id（只匹配启用中的分类；未匹配回落第一个启用分类）
fn resolve_category(conn: &Connection, name: Option<&str>) -> AppResult<i64> {
    match name {
        Some(n) if !n.is_empty() => {
            let hit: Option<i64> = conn
                .query_row(
                    "SELECT id FROM categories WHERE name=?1 AND enabled=1",
                    params![n],
                    |r| r.get(0),
                )
                .ok();
            Ok(hit.unwrap_or_else(|| crate::commands::categories::first_enabled_category(conn)))
        }
        _ => Ok(crate::commands::categories::first_enabled_category(conn)),
    }
}

fn valid_priority(p: Option<&str>) -> String {
    match p {
        Some(v @ ("low" | "normal" | "high" | "urgent")) => v.to_string(),
        _ => "normal".into(),
    }
}

/// 用消息上的 AI 建议创建待办（含标签/优先级/截止时间），并回写消息状态。
/// accept_chat_message 与 force_create_todo 共用。
pub(crate) fn create_task_from_message(conn: &Connection, msg: &ChatMessage) -> AppResult<i64> {
    let title = msg
        .suggested_title
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| msg.content.chars().take(40).collect());
    let category_id = resolve_category(conn, msg.suggested_category.as_deref())?;
    let priority = valid_priority(msg.suggested_priority.as_deref());
    let status = if msg.suggested_due.is_some() {
        "scheduled"
    } else {
        "inbox"
    };
    conn.execute(
        "INSERT INTO tasks (title, note, category_id, status, priority, due_at, source, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,'feishu',?7)",
        params![
            title,
            msg.suggested_note,
            category_id,
            status,
            priority,
            msg.suggested_due,
            now()
        ],
    )?;
    let task_id = conn.last_insert_rowid();
    let tag_ids = resolve_tag_ids(conn, &msg.suggested_tags)?;
    if !tag_ids.is_empty() {
        let mut stmt =
            conn.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?1, ?2)")?;
        for tag_id in &tag_ids {
            stmt.execute(params![task_id, tag_id])?;
        }
    }
    crate::commands::tasks::log_change(
        conn,
        task_id,
        "create",
        "title",
        None,
        Some(&title),
        "radio",
    )?;
    conn.execute(
        "UPDATE chat_messages SET review_status='accepted', task_id=?2 WHERE id=?1",
        params![msg.id, task_id],
    )?;
    Ok(task_id)
}

/// 捕捉：把 AI 建议落成待办
#[tauri::command]
pub fn accept_chat_message<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
) -> AppResult<i64> {
    let task_id = {
        let conn = db.0.lock().unwrap();
        let msg = get_message(&conn, id)?;
        if msg.task_id.is_some() {
            return Err(AppError::Invalid("该消息已创建过待办".into()));
        }
        create_task_from_message(&conn, &msg)?
    };
    events::broadcast(&app, events::TASKS_CHANGED);
    events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
    Ok(task_id)
}

/// 逃走：忽略这条建议（消息仍保留在收音机里）
#[tauri::command]
pub fn dismiss_chat_message<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
) -> AppResult<()> {
    db.0.lock().unwrap().execute(
        "UPDATE chat_messages SET review_status='dismissed' WHERE id=?1",
        params![id],
    )?;
    events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
    Ok(())
}

/// 应用 AI 的更新建议：把消息建议字段里**明确给出**的部分打补丁到目标待办
/// （复用 update_task 的校验 / 标签替换 / 草丛不变量 / 字段级操作日志），
/// 然后把消息标记为已接受。留空的字段一律不动。
#[tauri::command]
pub fn apply_chat_message_update<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
) -> AppResult<i64> {
    let (task_id, patch) = {
        let conn = db.0.lock().unwrap();
        let msg = get_message(&conn, id)?;
        if msg.review_status != "pending" || msg.ai_status != "update" {
            return Err(AppError::Invalid("该消息不是待确认的更新建议".into()));
        }
        let Some(task_id) = msg.update_task_id else {
            return Err(AppError::Invalid("更新建议缺少目标待办".into()));
        };
        // 目标已删除则无法应用（提前报错，避免先接受再失败）
        conn.query_row(
            "SELECT title FROM tasks WHERE id=?1",
            params![task_id],
            |r| r.get::<_, String>(0),
        )
        .map_err(|_| AppError::NotFound(format!("目标待办 No.{task_id} 已不存在，无法应用更新")))?;

        let mut patch = TaskPatch {
            id: task_id,
            title: None,
            note: None,
            category_id: None,
            priority: None,
            due_at: None,
            remind_at: None,
            status: None,
            tag_ids: None,
        };
        if let Some(v) = msg
            .suggested_title
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            patch.title = Some(v.to_string());
        }
        if let Some(v) = msg
            .suggested_note
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            patch.note = Some(v.to_string());
        }
        if let Some(v) = msg.suggested_due.as_deref().filter(|s| !s.is_empty()) {
            patch.due_at = Some(serde_json::Value::String(v.to_string()));
        }
        if let Some(v) = msg
            .suggested_priority
            .as_deref()
            .filter(|p| matches!(*p, "low" | "normal" | "high" | "urgent"))
        {
            patch.priority = Some(v.to_string());
        }
        // 分类只认启用中的同名分类，认不出就不动（不同于新建的回落策略）
        if let Some(name) = msg.suggested_category.as_deref().filter(|s| !s.is_empty()) {
            if let Ok(cid) = conn.query_row(
                "SELECT id FROM categories WHERE name=?1 AND enabled=1",
                params![name],
                |r| r.get::<_, i64>(0),
            ) {
                patch.category_id = Some(cid);
            }
        }
        // AI 给了新标签数组（非空）才全量替换
        if !msg.suggested_tags.is_empty() {
            patch.tag_ids = Some(resolve_tag_ids(&conn, &msg.suggested_tags)?);
        }
        if patch.title.is_none()
            && patch.note.is_none()
            && patch.category_id.is_none()
            && patch.priority.is_none()
            && patch.due_at.is_none()
            && patch.tag_ids.is_none()
        {
            return Err(AppError::Invalid("更新建议没有任何可应用的变更".into()));
        }
        conn.execute(
            "UPDATE chat_messages SET review_status='accepted' WHERE id=?1",
            params![id],
        )?;
        (task_id, patch)
    };
    update_task(app.clone(), db, patch, Some("radio".into()))?;
    events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
    Ok(task_id)
}

/// 组装判重上下文：现有未完成待办 + 分类 + 标签
pub(crate) fn classify_context(conn: &Connection) -> AppResult<ClassifyContext> {
    let open_tasks: Vec<(i64, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, title FROM tasks WHERE status IN ('inbox','scheduled','active','paused') ORDER BY id",
        )?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    let categories: Vec<String> = {
        let mut stmt = conn.prepare("SELECT name FROM categories WHERE enabled=1 ORDER BY id")?;
        let rows = stmt
            .query_map([], |r| r.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    let tags: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT name, description FROM tags ORDER BY id")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    Ok(ClassifyContext {
        open_tasks,
        categories,
        tags,
    })
}

/// AI prompt 里的来源标签：告诉模型消息来自哪种会话、谁在说话
pub(crate) fn chat_label(chat_type: &str, chat_name: &str) -> String {
    match chat_type {
        "bot" => "飞书·机器人私聊".into(),
        "p2p" => format!("飞书·私聊「{chat_name}」"),
        "group" => format!("飞书·群聊「{chat_name}」"),
        _ => {
            if chat_name.is_empty() {
                "飞书".into()
            } else {
                format!("飞书「{chat_name}」")
            }
        }
    }
}

/// 同会话近期上下文（发送时间在 [sent_at - window, sent_at) 内的最近 max 条），
/// 格式化为 "HH:MM 发送者: 内容"，自己发的标注为「我」。供 AI 理解对话背景。
pub(crate) fn chat_context_lines(
    conn: &Connection,
    chat_id: &str,
    sent_at: i64,
    exclude_message_id: &str,
    window_ms: i64,
    max_messages: i64,
) -> Vec<String> {
    if chat_id.is_empty() || sent_at <= 0 {
        return vec![];
    }
    let mut stmt = match conn.prepare(
        "SELECT sender, is_self, content, sent_at FROM chat_messages
         WHERE chat_id=?1 AND sent_at IS NOT NULL AND sent_at >= ?2 AND sent_at < ?3 AND message_id != ?4
         ORDER BY sent_at DESC LIMIT ?5",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    let rows: Vec<(String, i64, String, i64)> = match stmt.query_map(
        params![
            chat_id,
            sent_at - window_ms,
            sent_at,
            exclude_message_id,
            max_messages
        ],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    ) {
        Ok(rows) => rows.flatten().collect(),
        Err(_) => return vec![],
    };
    rows.into_iter()
        .rev() // 查询取最近 N 条的倒序，还原为时间升序
        .map(|(sender, is_self, content, at)| {
            let who = if is_self != 0 { "我" } else { sender.as_str() };
            let time = chrono::Local
                .timestamp_millis_opt(at)
                .single()
                .map(|t| t.format("%H:%M").to_string())
                .unwrap_or_default();
            let clipped: String = content.chars().take(200).collect();
            format!("[{time}] {who}: {clipped}")
        })
        .collect()
}

/// 强制为消息创建待办：先让 AI 判重（对照现有待办清单），
/// 判定为跟进/重复则不建并告知；其余情况照建（AI 建议优先，无建议用消息截断）。
#[tauri::command]
pub async fn force_create_todo<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<'_, Db>,
    id: i64,
) -> AppResult<i64> {
    let (msg, agent) = {
        let conn = db.0.lock().unwrap();
        let msg = get_message(&conn, id)?;
        if msg.task_id.is_some() {
            return Err(AppError::Invalid("该消息已创建过待办".into()));
        }
        let get = |k: &str| -> Option<String> {
            conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
                r.get::<_, String>(0)
            })
            .ok()
        };
        let agent: Option<AgentConfig> = ai::primary_agent(&get);
        (msg, agent)
    };
    let agent = agent.ok_or_else(|| AppError::Invalid("请先在设置中配置 AI Agent".into()))?;

    // 判定对象带上来源标签与同会话近期上下文，和后台轮询的语境一致
    let (ctx, label, context) = {
        let conn = db.0.lock().unwrap();
        let ctx = classify_context(&conn)?;
        let label = chat_label(&msg.chat_type, &msg.chat_name);
        let context = match msg.sent_at {
            Some(at) => {
                chat_context_lines(&conn, &msg.chat_id, at, &msg.message_id, 30 * 60 * 1000, 10)
            }
            None => vec![],
        };
        (ctx, label, context)
    };
    let res = ai::classify(
        &agent,
        &[AiMessage {
            message_id: msg.message_id.clone(),
            sender: msg.sender.clone(),
            chat_label: label,
            content: msg.content.clone(),
            context,
        }],
        &ctx,
    )
    .await;

    let sugg = match res {
        Ok(s) => s.into_iter().find(|s| s.message_id == msg.message_id),
        Err(e) => {
            let conn = db.0.lock().unwrap();
            let _ = conn.execute(
                "UPDATE chat_messages SET ai_status='error' WHERE id=?1",
                params![id],
            );
            return Err(e);
        }
    };

    // AI 判重：消息是现有待办的跟进 → 挂跟进记录，不重复建待办
    if let Some(s) = &sugg {
        if s.is_follow_up() {
            let task_id = s.follow_up_task_id.unwrap();
            let conn = db.0.lock().unwrap();
            let title: Option<String> = conn
                .query_row(
                    "SELECT title FROM tasks WHERE id=?1",
                    params![task_id],
                    |r| r.get(0),
                )
                .ok();
            if title.is_none() {
                return Err(AppError::Invalid(format!(
                    "AI 认为是待办 {task_id} 的跟进，但该待办已不存在"
                )));
            }
            conn.execute(
                "INSERT INTO task_notes (task_id, content, source, created_at) VALUES (?1, ?2, 'ai', ?3)",
                params![task_id, msg.content, now()],
            )?;
            conn.execute(
                "UPDATE chat_messages SET ai_status='followup' WHERE id=?1",
                params![id],
            )?;
            drop(conn);
            events::broadcast(&app, events::TASKS_CHANGED);
            events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
            let title = title.unwrap_or_default();
            return Err(AppError::Invalid(format!(
                "AI 判重：该消息是待办 No.{task_id}「{title}」的跟进，已添加跟进记录"
            )));
        }
    }

    // AI 判定消息是现有待办的变更（改期/改优先级等）→ 不建新待办，
    // 落成「更新建议」卡由用户在收音机确认应用
    if let Some(s) = &sugg {
        if s.is_update() {
            let task_id = s.update_task_id.unwrap();
            let conn = db.0.lock().unwrap();
            let title: Option<String> = conn
                .query_row(
                    "SELECT title FROM tasks WHERE id=?1",
                    params![task_id],
                    |r| r.get(0),
                )
                .ok();
            if title.is_none() {
                return Err(AppError::Invalid(format!(
                    "AI 认为是待办 {task_id} 的变更，但该待办已不存在"
                )));
            }
            conn.execute(
                "UPDATE chat_messages SET suggested_title=?2, suggested_category=?3, suggested_due=?4,
                        suggested_priority=?5, suggested_note=?6, suggested_tags=?7, update_task_id=?8, ai_status='update'
                 WHERE id=?1",
                params![
                    id,
                    s.title,
                    s.category,
                    s.due,
                    s.priority,
                    s.note,
                    serde_json::to_string(&s.tags).unwrap_or_else(|_| "[]".into()),
                    task_id,
                ],
            )?;
            drop(conn);
            events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
            let title = title.unwrap_or_default();
            return Err(AppError::Invalid(format!(
                "AI 判定：该消息是待办 No.{task_id}「{title}」的变更而非新待办，已生成更新建议，请到收音机确认应用"
            )));
        }
    }

    // 照建：AI 给了建议就用建议（todo），否则用消息截断兜底（none/缺失）
    let task_id = {
        let conn = db.0.lock().unwrap();
        let mut msg = get_message(&conn, id)?;
        if let Some(s) = &sugg {
            conn.execute(
                "UPDATE chat_messages SET suggested_title=?2, suggested_category=?3, suggested_due=?4,
                        suggested_priority=?5, suggested_note=?6, suggested_tags=?7, ai_status='todo'
                 WHERE id=?1",
                params![
                    id,
                    s.title,
                    s.category,
                    s.due,
                    s.priority,
                    s.note,
                    serde_json::to_string(&s.tags).unwrap_or_else(|_| "[]".into()),
                ],
            )?;
            msg = get_message(&conn, id)?;
        }
        create_task_from_message(&conn, &msg)?
    };
    events::broadcast(&app, events::TASKS_CHANGED);
    events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
    Ok(task_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::tasks::{get_task, list_tasks};
    use crate::commands::windows::PendingMainReopen;
    use crate::db::tests::test_conn;
    use std::sync::Mutex;
    use tauri::Manager;

    fn setup() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(Db(Mutex::new(test_conn())));
        app.manage(PendingMainReopen(std::sync::atomic::AtomicBool::new(false)));
        app
    }

    fn seed_message(app: &tauri::App<tauri::test::MockRuntime>, msg_id: &str) -> i64 {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO chat_messages (message_id, chat_name, sender, content, suggested_title, suggested_category,
                                        suggested_due, suggested_priority, suggested_note, suggested_tags, ai_status, review_status, created_at)
             VALUES (?1, '项目群', '张三', '明天上午10点开周会', '参加周会', '工作',
                     '2026-09-13T10:00', 'high', '张三在群里安排', '[\"重要\"]', 'todo', 'pending', '2026-09-11T00:00:00Z')",
            params![msg_id],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn seed_tag(app: &tauri::App<tauri::test::MockRuntime>, name: &str) -> i64 {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO tags (name, description, created_at) VALUES (?1, '', '2026-09-01T00:00:00Z')",
            params![name],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn accept_creates_task_with_all_ai_attributes() {
        let app = setup();
        seed_tag(&app, "重要");
        let mid = seed_message(&app, "om_1");
        let task_id = {
            let db = app.state::<Db>();
            accept_chat_message(app.handle().clone(), db, mid).unwrap()
        };
        let task = {
            let db = app.state::<Db>();
            get_task(db, task_id).unwrap()
        };
        assert_eq!(task.title, "参加周会");
        assert_eq!(task.note.as_deref(), Some("张三在群里安排"));
        assert_eq!(task.priority, "high");
        assert_eq!(task.due_at.as_deref(), Some("2026-09-13T10:00"));
        assert_eq!(task.status, "scheduled", "有截止时间直接进路线");
        assert_eq!(task.source, "feishu");
        assert_eq!(task.tags, vec!["重要".to_string()], "AI 建议标签挂上");
        // 二次接受被拒绝
        let err = {
            let db = app.state::<Db>();
            accept_chat_message(app.handle().clone(), db, mid).unwrap_err()
        };
        assert!(matches!(err, AppError::Invalid(_)));
    }

    #[test]
    fn accept_without_suggestion_truncates_content() {
        let app = setup();
        let mid = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let long = "很长的消息".repeat(20);
            conn.execute(
                "INSERT INTO chat_messages (message_id, chat_name, sender, content, ai_status, review_status, created_at)
                 VALUES ('om_2', '', '', ?1, 'none', 'pending', '2026-09-01T00:00:00Z')",
                params![long],
            )
            .unwrap();
            conn.last_insert_rowid()
        };
        let task_id = {
            let db = app.state::<Db>();
            accept_chat_message(app.handle().clone(), db, mid).unwrap()
        };
        let task = {
            let db = app.state::<Db>();
            get_task(db, task_id).unwrap()
        };
        assert_eq!(task.title.chars().count(), 40);
        assert_eq!(task.status, "inbox", "无截止时间进草丛");
        assert_eq!(task.category_id, 1, "未知分类回落默认");
    }

    #[test]
    fn list_and_search_chat_messages() {
        let app = setup();
        seed_message(&app, "om_1");
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO chat_messages (message_id, chat_name, sender, content, ai_status, review_status, created_at)
                 VALUES ('om_2', '闲聊群', '李四', '哈哈哈', 'none', 'pending', '2026-09-01T00:00:00Z')",
                [],
            )
            .unwrap();
        }
        let all = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        assert_eq!(all.len(), 2, "未识别为待办的消息也展示");
        assert_eq!(all[0].message_id, "om_2", "倒序");

        let hit = {
            let db = app.state::<Db>();
            list_chat_messages(db, Some("周会".into())).unwrap()
        };
        assert_eq!(hit.len(), 1);
        assert_eq!(hit[0].suggested_title.as_deref(), Some("参加周会"));
        assert_eq!(hit[0].suggested_tags, vec!["重要".to_string()]);

        let by_chat = {
            let db = app.state::<Db>();
            list_chat_messages(db, Some("闲聊".into())).unwrap()
        };
        assert_eq!(by_chat.len(), 1, "按会话名搜索");

        let none = {
            let db = app.state::<Db>();
            list_chat_messages(db, Some("%".into())).unwrap()
        };
        assert!(none.is_empty(), "LIKE 通配符转义");
    }

    #[test]
    fn dismiss_marks_review_status() {
        let app = setup();
        let mid = seed_message(&app, "om_1");
        {
            let db = app.state::<Db>();
            dismiss_chat_message(app.handle().clone(), db, mid).unwrap();
        }
        let msgs = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        assert_eq!(msgs[0].review_status, "dismissed");
        assert!(msgs[0].task_id.is_none(), "逃走不删消息");
    }

    #[test]
    fn classify_context_lists_open_tasks_categories_tags() {
        let app = setup();
        seed_tag(&app, "重要");
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO tasks (title, status, created_at) VALUES ('进行中的', 'scheduled', '2026-09-01T00:00:00Z')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO tasks (title, status, completed_at, created_at) VALUES ('完成的', 'done', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')",
                [],
            )
            .unwrap();
        }
        let ctx = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            classify_context(&conn).unwrap()
        };
        assert_eq!(
            ctx.open_tasks,
            vec![(1_i64, "进行中的".to_string())],
            "done 不进判重清单"
        );
        assert!(ctx.categories.contains(&"工作".to_string()));
        assert_eq!(ctx.tags, vec![("重要".to_string(), String::new())]);
    }

    /// 停用的分类不进 AI 分类选项
    #[test]
    fn classify_context_excludes_disabled_categories() {
        let app = setup();
        {
            let db = app.state::<Db>();
            crate::commands::categories::set_category_enabled(app.handle().clone(), db, 1, false)
                .unwrap();
        }
        let ctx = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            classify_context(&conn).unwrap()
        };
        assert!(
            !ctx.categories.contains(&"工作".to_string()),
            "停用分类不进 prompt"
        );
        assert_eq!(ctx.categories.first().map(String::as_str), Some("学习"));
    }

    /// AI 建议了停用分类名时，回落到第一个启用分类而不是停用的同名分类
    #[test]
    fn resolve_category_skips_disabled_fallback() {
        let app = setup();
        {
            let db = app.state::<Db>();
            crate::commands::categories::set_category_enabled(app.handle().clone(), db, 1, false)
                .unwrap();
        }
        let task_id = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO chat_messages (message_id, content, suggested_title, suggested_category, ai_status, review_status, created_at)
                 VALUES ('om_d', '内容', '标题', '工作', 'todo', 'pending', '2026-09-01T00:00:00Z')",
                [],
            )
            .unwrap();
            let msg = get_message(&conn, 1).unwrap();
            create_task_from_message(&conn, &msg).unwrap()
        };
        let task = {
            let db = app.state::<Db>();
            crate::commands::tasks::get_task(db, task_id).unwrap()
        };
        assert_eq!(
            task.category_id, 2,
            "停用的「工作」被跳过，落到第一个启用分类"
        );
    }

    /// 强制建待办的 AI 判重分支（不走 HTTP，直接构造 AppError 路径之外的状态机）：
    /// 已建过待办的消息直接拒绝
    #[test]
    fn force_create_rejects_message_with_existing_task() {
        let app = setup();
        let mid = seed_message(&app, "om_1");
        {
            let db = app.state::<Db>();
            accept_chat_message(app.handle().clone(), db, mid).unwrap();
        }
        let err = tauri::async_runtime::block_on(async {
            let db = app.state::<Db>();
            force_create_todo(app.handle().clone(), db, mid).await
        })
        .unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }

    /// 未配置 AI 时强制建待办给出可操作的提示
    #[test]
    fn force_create_requires_ai_config() {
        let app = setup();
        let mid = seed_message(&app, "om_1");
        let err = tauri::async_runtime::block_on(async {
            let db = app.state::<Db>();
            force_create_todo(app.handle().clone(), db, mid).await
        })
        .unwrap_err();
        assert!(err.to_string().contains("AI"), "提示配置 AI: {err}");
    }

    #[test]
    fn create_task_from_message_resolves_partial_attributes() {
        let app = setup();
        seed_tag(&app, "重要");
        let task_id = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            // 非法优先级、未知分类、未知标签都应安全回落
            conn.execute(
                "INSERT INTO chat_messages (message_id, content, suggested_title, suggested_category, suggested_priority, suggested_tags, ai_status, review_status, created_at)
                 VALUES ('om_x', '周五之前交报告', '交报告', '不存在的分类', 'super-urgent', '[\"重要\",\"不存在的标签\"]', 'todo', 'pending', '2026-09-01T00:00:00Z')",
                [],
            )
            .unwrap();
            let msg = get_message(&conn, 1).unwrap();
            create_task_from_message(&conn, &msg).unwrap()
        };
        let task = {
            let db = app.state::<Db>();
            get_task(db, task_id).unwrap()
        };
        assert_eq!(task.priority, "normal", "非法优先级回落 normal");
        assert_eq!(task.category_id, 1, "未知分类回落 1");
        assert_eq!(task.tags, vec!["重要".to_string()], "未知标签丢弃");
    }

    /// 回归：accept 后任务出现在 open 列表（避免 INSERT 字段错位静默失败）
    #[test]
    fn accepted_task_shows_in_open_list() {
        let app = setup();
        let mid = seed_message(&app, "om_1");
        let task_id = {
            let db = app.state::<Db>();
            accept_chat_message(app.handle().clone(), db, mid).unwrap()
        };
        let open = {
            let db = app.state::<Db>();
            list_tasks(db, "open".into()).unwrap()
        };
        assert!(open.iter().any(|t| t.id == task_id));
    }

    /// 仅作上下文的消息（自己发的/机器人回复，ai_status=skipped）不进收音机列表与搜索
    #[test]
    fn list_hides_context_only_messages() {
        let app = setup();
        seed_message(&app, "om_1");
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO chat_messages (message_id, chat_name, sender, content, ai_status, review_status, created_at)
                 VALUES ('om_ctx', '项目群', '我', '好的马上', 'skipped', 'pending', '2026-09-12T00:00:00Z')",
                [],
            )
            .unwrap();
        }
        let all = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        assert_eq!(all.len(), 1, "只展示送 AI 判定的消息");
        assert_eq!(all[0].message_id, "om_1");
        let hit = {
            let db = app.state::<Db>();
            list_chat_messages(db, Some("好的马上".into())).unwrap()
        };
        assert!(hit.is_empty(), "上下文消息不进搜索");
    }

    /// 上下文窗口：同会话、时间在 [t-30min, t) 的消息按时间升序拼接，
    /// 自己发的标注「我」；之后的/超窗的/别的会话的都不算
    #[test]
    fn chat_context_lines_picks_recent_same_chat_only() {
        let app = setup();
        let t = 1_789_200_000_000i64;
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let ins = |mid: &str, chat: &str, sender: &str, is_self: i64, at: i64| {
                conn.execute(
                    "INSERT INTO chat_messages (message_id, chat_id, chat_name, chat_type, sender, content, sent_at, is_self, ai_status, review_status, created_at)
                     VALUES (?1, ?2, '项目群', 'group', ?3, '内容', ?4, ?5, 'skipped', 'pending', '2026-09-12T00:00:00Z')",
                    params![mid, chat, sender, at, is_self],
                )
                .unwrap();
            };
            ins("om_me", "oc_g", "我的显示名", 1, t - 60_000);
            ins("om_other", "oc_g", "李四", 0, t - 30_000);
            ins("om_after", "oc_g", "李四", 0, t + 10_000);
            ins("om_stale", "oc_g", "李四", 0, t - 40 * 60_000);
            ins("om_else", "oc_h", "李四", 0, t - 10_000);
        }
        let lines = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            chat_context_lines(&conn, "oc_g", t, "om_target", 30 * 60 * 1000, 10)
        };
        assert_eq!(lines.len(), 2, "{lines:?}");
        assert!(
            lines[0].contains("我: 内容"),
            "时间升序且自己标注为「我」: {lines:?}"
        );
        assert!(
            !lines[0].contains("我的显示名"),
            "不暴露原始显示名以免与「我」混淆: {lines:?}"
        );
        assert!(lines[1].contains("李四: 内容"), "{lines:?}");
        // 空会话 / 老数据（无 sent_at）安全退化为空
        let empty = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            chat_context_lines(&conn, "", t, "om_target", 30 * 60 * 1000, 10)
        };
        assert!(empty.is_empty());
    }

    /// 种一条「更新建议」消息（pending，指向 task_id，可指定建议字段）
    fn seed_update_message(
        app: &tauri::App<tauri::test::MockRuntime>,
        msg_id: &str,
        update_task_id: Option<i64>,
        suggested_due: Option<&str>,
        suggested_priority: Option<&str>,
        suggested_title: Option<&str>,
        suggested_tags: &str,
    ) -> i64 {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO chat_messages (message_id, chat_name, sender, content, suggested_title, suggested_due,
                                        suggested_priority, suggested_tags, update_task_id, ai_status, review_status, created_at)
             VALUES (?1, '项目群', '张三', '周会改到周四上午10点', ?2, ?3, ?4, ?5, ?6, 'update', 'pending', '2026-09-12T00:00:00Z')",
            params![
                msg_id,
                suggested_title,
                suggested_due,
                suggested_priority,
                suggested_tags,
                update_task_id
            ],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn seed_task(app: &tauri::App<tauri::test::MockRuntime>, title: &str) -> i64 {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (title, status, priority, due_at, created_at)
             VALUES (?1, 'scheduled', 'normal', '2026-09-13T10:00', '2026-09-01T00:00:00Z')",
            params![title],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    /// 应用更新建议：只改 AI 明确给出的字段，其余保持；写入字段级操作日志；消息转为已接受
    #[test]
    fn apply_update_patches_only_given_fields() {
        let app = setup();
        seed_tag(&app, "重要");
        let task_id = seed_task(&app, "参加周会");
        let mid = seed_update_message(
            &app,
            "om_u1",
            Some(task_id),
            Some("2026-09-14T10:00"),
            Some("high"),
            Some("周会（改期）"),
            "[\"重要\"]",
        );
        {
            let db = app.state::<Db>();
            apply_chat_message_update(app.handle().clone(), db, mid).unwrap();
        }
        let task = {
            let db = app.state::<Db>();
            get_task(db, task_id).unwrap()
        };
        assert_eq!(task.title, "周会（改期）");
        assert_eq!(task.due_at.as_deref(), Some("2026-09-14T10:00"));
        assert_eq!(task.priority, "high");
        assert_eq!(task.tags, vec!["重要".to_string()], "标签全量替换");
        assert_eq!(task.status, "scheduled");
        // 字段级日志（origin=radio）
        let logs: Vec<(String, String)> = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let mut stmt = conn
                .prepare("SELECT field, origin FROM task_logs WHERE task_id=?1 AND action='update'")
                .unwrap();
            stmt.query_map(params![task_id], |r| Ok((r.get(0)?, r.get(1)?)))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert!(logs.len() >= 3, "title/due/priority 各一条: {logs:?}");
        assert!(logs.iter().all(|(_, o)| o == "radio"));
        // 消息转为已接受
        let msgs = {
            let db = app.state::<Db>();
            list_chat_messages(db, None).unwrap()
        };
        let m = msgs.iter().find(|m| m.id == mid).unwrap();
        assert_eq!(m.review_status, "accepted");
        assert_eq!(m.update_task_id, Some(task_id));
        // 二次应用被拒绝
        let err = {
            let db = app.state::<Db>();
            apply_chat_message_update(app.handle().clone(), db, mid).unwrap_err()
        };
        assert!(matches!(err, AppError::Invalid(_)));
    }

    /// 部分字段的建议只动那一处：只改 due，标题/优先级/标签都不变
    #[test]
    fn apply_update_partial_only_touches_due() {
        let app = setup();
        let task_id = seed_task(&app, "参加周会");
        let mid = seed_update_message(
            &app,
            "om_u2",
            Some(task_id),
            Some("2026-09-15T09:00"),
            None,
            None,
            "[]",
        );
        {
            let db = app.state::<Db>();
            apply_chat_message_update(app.handle().clone(), db, mid).unwrap();
        }
        let task = {
            let db = app.state::<Db>();
            get_task(db, task_id).unwrap()
        };
        assert_eq!(task.due_at.as_deref(), Some("2026-09-15T09:00"));
        assert_eq!(task.title, "参加周会");
        assert_eq!(task.priority, "normal");
        assert!(task.tags.is_empty());
    }

    /// 异常路径：非 update 状态 / 缺目标 / 目标已删 / 无可应用字段
    #[test]
    fn apply_update_rejects_invalid_states() {
        let app = setup();
        // 1. 普通 todo 建议不能走应用更新
        let todo_mid = seed_message(&app, "om_t");
        let err = {
            let db = app.state::<Db>();
            apply_chat_message_update(app.handle().clone(), db, todo_mid).unwrap_err()
        };
        assert!(matches!(err, AppError::Invalid(_)));
        // 2. 缺目标待办
        let mid = seed_update_message(
            &app,
            "om_u3",
            None,
            Some("2026-09-15T09:00"),
            None,
            None,
            "[]",
        );
        let err = {
            let db = app.state::<Db>();
            apply_chat_message_update(app.handle().clone(), db, mid).unwrap_err()
        };
        assert!(matches!(err, AppError::Invalid(_)));
        // 3. 目标待办不存在 → NotFound
        let mid = seed_update_message(
            &app,
            "om_u4",
            Some(999),
            Some("2026-09-15T09:00"),
            None,
            None,
            "[]",
        );
        let err = {
            let db = app.state::<Db>();
            apply_chat_message_update(app.handle().clone(), db, mid).unwrap_err()
        };
        assert!(matches!(err, AppError::NotFound(_)), "{err}");
        // 4. 没有任何建议字段（目标存在但没有可应用变更）
        let real_task = seed_task(&app, "真实任务");
        let mid = seed_update_message(&app, "om_u5", Some(real_task), None, None, None, "[]");
        let err = {
            let db = app.state::<Db>();
            apply_chat_message_update(app.handle().clone(), db, mid).unwrap_err()
        };
        assert!(err.to_string().contains("可应用"), "{err}");
    }

    #[test]
    fn chat_label_variants() {
        assert_eq!(chat_label("bot", "皮卡丘助手"), "飞书·机器人私聊");
        assert_eq!(chat_label("p2p", "李四"), "飞书·私聊「李四」");
        assert_eq!(chat_label("group", "项目群"), "飞书·群聊「项目群」");
        assert_eq!(chat_label("", ""), "飞书");
    }
}
