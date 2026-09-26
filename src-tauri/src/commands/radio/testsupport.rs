//! 收音机域测试共用夹具：mock 应用与消息/标签/待办/agent/判定状态种子。
use crate::commands::windows::PendingMainReopen;
use crate::db::tests::test_conn;
use crate::db::Db;
use rusqlite::params;
use std::sync::Mutex;
use tauri::Manager;

pub(crate) fn setup() -> tauri::App<tauri::test::MockRuntime> {
    let app = tauri::test::mock_app();
    app.manage(Db(Mutex::new(test_conn())));
    app.manage(crate::health::HealthState::default());
    app.manage(PendingMainReopen(std::sync::atomic::AtomicBool::new(false)));
    app
}

pub(crate) fn seed_message(app: &tauri::App<tauri::test::MockRuntime>, msg_id: &str) -> i64 {
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

pub(crate) fn seed_tag(app: &tauri::App<tauri::test::MockRuntime>, name: &str) -> i64 {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO tags (name, description, created_at) VALUES (?1, '', '2026-09-01T00:00:00Z')",
        params![name],
    )
    .unwrap();
    conn.last_insert_rowid()
}

/// 种一条「更新建议」消息（pending，指向 task_id，可指定建议字段）
pub(crate) fn seed_update_message(
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

pub(crate) fn seed_task(app: &tauri::App<tauri::test::MockRuntime>, title: &str) -> i64 {
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

pub(crate) fn seed_agent(app: &tauri::App<tauri::test::MockRuntime>, command: &str) {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('ai_agents', ?1)",
        params![serde_json::to_string(&[crate::ai::AgentConfig {
            id: "fake".into(),
            name: "Fake".into(),
            command: command.into(),
            timeout_secs: 10,
            ..Default::default()
        }])
        .unwrap()],
    )
    .unwrap();
}

pub(crate) fn seed_status_message(
    app: &tauri::App<tauri::test::MockRuntime>,
    msg_id: &str,
    ai_status: &str,
    review_status: &str,
) -> i64 {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO chat_messages (message_id, chat_name, sender, content, suggested_title,
                                    ai_status, review_status, created_at)
         VALUES (?1, '项目群', '张三', '明天 10 点开周会', '残留建议', ?2, ?3, '2026-09-11T00:00:00Z')",
        params![msg_id, ai_status, review_status],
    )
    .unwrap();
    conn.last_insert_rowid()
}

pub(crate) fn ai_status_of(
    app: &tauri::App<tauri::test::MockRuntime>,
    msg_id: &str,
) -> (String, Option<String>) {
    let db = app.state::<Db>();
    let conn = db.0.lock().unwrap();
    conn.query_row(
        "SELECT ai_status, suggested_title FROM chat_messages WHERE message_id=?1",
        params![msg_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .unwrap()
}
