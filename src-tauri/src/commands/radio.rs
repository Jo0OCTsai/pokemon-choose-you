use crate::ai::{self, AiConfig, ClassifyContext};
use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::models::ChatMessage;
use rusqlite::{params, Connection};
use tauri::State;

const MSG_COLS: &str = "id, message_id, chat_name, sender, content, suggested_title, suggested_category, suggested_due, suggested_priority, suggested_note, suggested_tags, ai_status, review_status, task_id, created_at";

fn row_to_message(row: &rusqlite::Row) -> rusqlite::Result<ChatMessage> {
    let tags_raw: String = row.get(10)?;
    Ok(ChatMessage {
        id: row.get(0)?,
        message_id: row.get(1)?,
        chat_name: row.get(2)?,
        sender: row.get(3)?,
        content: row.get(4)?,
        suggested_title: row.get(5)?,
        suggested_category: row.get(6)?,
        suggested_due: row.get(7)?,
        suggested_priority: row.get(8)?,
        suggested_note: row.get(9)?,
        suggested_tags: serde_json::from_str(&tags_raw).unwrap_or_default(),
        ai_status: row.get(11)?,
        review_status: row.get(12)?,
        task_id: row.get(13)?,
        created_at: row.get(14)?,
    })
}

/// 收音机电波列表：全量消息（含 AI 未识别为待办的），可按关键词过滤
#[tauri::command]
pub fn list_chat_messages(db: State<Db>, query: Option<String>) -> AppResult<Vec<ChatMessage>> {
    let conn = db.0.lock().unwrap();
    let q = query.unwrap_or_default().trim().to_string();
    let rows = if q.is_empty() {
        let mut stmt = conn.prepare(&format!(
            "SELECT {MSG_COLS} FROM chat_messages ORDER BY id DESC LIMIT 300"
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
             WHERE content LIKE ?1 ESCAPE '\\' OR chat_name LIKE ?1 ESCAPE '\\' OR sender LIKE ?1 ESCAPE '\\'
               OR suggested_title LIKE ?1 ESCAPE '\\'
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

/// 分类名 → 分类 id（未匹配回落到 1，与默认分类对齐）
fn resolve_category(conn: &Connection, name: Option<&str>) -> AppResult<i64> {
    match name {
        Some(n) if !n.is_empty() => Ok(conn
            .query_row("SELECT id FROM categories WHERE name=?1", params![n], |r| {
                r.get(0)
            })
            .unwrap_or(1)),
        _ => Ok(1),
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
        let mut stmt = conn.prepare("SELECT name FROM categories ORDER BY id")?;
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

/// 强制为消息创建待办：先让 AI 判重（对照现有待办清单），
/// 判定为跟进/重复则不建并告知；其余情况照建（AI 建议优先，无建议用消息截断）。
#[tauri::command]
pub async fn force_create_todo<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<'_, Db>,
    id: i64,
) -> AppResult<i64> {
    let (msg, cfg) = {
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
        let cfg: Option<AiConfig> = ai::load_config(&get);
        (msg, cfg)
    };
    let cfg = cfg.ok_or_else(|| AppError::Invalid("请先在设置中配置 AI 接口".into()))?;

    let ctx = {
        let conn = db.0.lock().unwrap();
        classify_context(&conn)?
    };
    let (res, record) = ai::classify(
        &cfg,
        "force_create",
        &[(
            msg.message_id.clone(),
            msg.sender.clone(),
            msg.content.clone(),
        )],
        &ctx,
    )
    .await;
    ai::save_log(&db, &record);

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
}
