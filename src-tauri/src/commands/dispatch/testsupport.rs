//! dispatch 域测试共用夹具：mock 应用、agent 配置种子与任务种子。
use super::meta::normalize_meta;
use crate::commands::tags::create_tag_conn;
use crate::commands::tasks::get_task_conn;
use crate::commands::windows::PendingMainReopen;
use crate::db::tests::test_conn;
use crate::db::Db;
use crate::models::{TagMeta, TagRef, Task};
use rusqlite::{params, Connection};
use std::sync::Mutex;
use tauri::Manager;

pub(crate) fn setup() -> tauri::App<tauri::test::MockRuntime> {
    let app = tauri::test::mock_app();
    app.manage(Db(Mutex::new(test_conn())));
    app.manage(PendingMainReopen(std::sync::atomic::AtomicBool::new(false)));
    app
}

pub(crate) fn agent_json(
    id: &str,
    name: &str,
    command: &str,
    enabled: bool,
    workdir: &str,
) -> String {
    serde_json::json!({
        "id": id, "name": name, "command": command, "args": "-p {prompt}",
        "historyArgs": "--resume", "timeoutSecs": 120, "enabled": enabled, "workdir": workdir
    })
    .to_string()
}

pub(crate) fn seed_agents(conn: &Connection, agents: &[String]) {
    let raw = format!("[{}]", agents.join(","));
    conn.execute(
        "INSERT INTO settings (key, value) VALUES ('ai_agents', ?1)",
        params![raw],
    )
    .unwrap();
}

/// 建任务 + 挂 project 标签（可选写 meta），返回任务
pub(crate) fn seed_task(conn: &Connection, project_tag: Option<(&str, Option<&TagMeta>)>) -> Task {
    conn.execute(
        "INSERT INTO tasks (title, note, status, created_at) VALUES ('修登录bug', '回归用', 'inbox', '2026-09-13T00:00:00Z')",
        [],
    )
    .unwrap();
    let task_id = conn.last_insert_rowid();
    let mut task = get_task_conn(conn, task_id).unwrap();
    if let Some((name, meta)) = project_tag {
        let tag = create_tag_conn(conn, name, "", "project", "manual").unwrap();
        if let Some(m) = meta {
            let encoded = serde_json::to_string(&normalize_meta(m.clone())).unwrap();
            conn.execute(
                "UPDATE tags SET meta=?1 WHERE id=?2",
                params![encoded, tag.id],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO task_tags (task_id, tag_id) VALUES (?1, ?2)",
            params![task_id, tag.id],
        )
        .unwrap();
        task.tags = vec![TagRef {
            name: name.into(),
            dimension: "project".into(),
        }];
    }
    task
}

/// 建到期任务并挂项目标签；meta 写在共享的标签行上——每例设置后紧跟断言，
/// 用例收尾把任务置 done 排除出后续轮次（避免共享 meta 串扰）
pub(crate) fn due_task(conn: &Connection, title: &str, due: &str, meta: Option<&str>) {
    conn.execute(
        "INSERT INTO tasks (title, status, due_at, created_at) VALUES (?1, 'scheduled', ?2, '2026-09-01T00:00:00Z')",
        params![title, due],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO task_tags (task_id, tag_id) VALUES (last_insert_rowid(), (SELECT id FROM tags WHERE name='PokemonApp'))",
        [],
    )
    .unwrap();
    if let Some(m) = meta {
        conn.execute(
            "UPDATE tags SET meta=?1 WHERE name='PokemonApp'",
            params![m],
        )
        .unwrap();
    }
}
