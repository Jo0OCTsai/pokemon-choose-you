use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::models::Task;
use rusqlite::{params, Connection};
use tauri::State;

fn row_to_task(row: &rusqlite::Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        note: row.get(2)?,
        category_id: row.get(3)?,
        status: row.get(4)?,
        priority: row.get(5)?,
        due_at: row.get(6)?,
        remind_at: row.get(7)?,
        reminded: row.get::<_, i64>(8)? != 0,
        source: row.get(9)?,
        external_id: row.get(10)?,
        created_at: row.get(11)?,
        completed_at: row.get(12)?,
        focus_seconds: row.get(13)?,
    })
}

const TASK_COLS: &str = "id, title, note, category_id, status, priority, due_at, remind_at, reminded, source, external_id, created_at, completed_at, focus_seconds";

#[tauri::command]
pub fn list_tasks(db: State<Db>, filter: String) -> AppResult<Vec<Task>> {
    let conn = db.0.lock().unwrap();
    let sql = match filter.as_str() {
        "open" => "SELECT {cols} FROM tasks WHERE status IN ('inbox','scheduled','active','paused') ORDER BY
                CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'scheduled' THEN 2 ELSE 3 END,
                CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                due_at IS NULL, due_at",
        "done" => "SELECT {cols} FROM tasks WHERE status='done' ORDER BY completed_at DESC LIMIT 200",
        "today" => "SELECT {cols} FROM tasks WHERE status IN ('inbox','scheduled','active','paused')
             AND (due_at IS NOT NULL AND date(due_at) <= date('now','localtime') OR status IN ('active','paused'))
             ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END",
        _ => "SELECT {cols} FROM tasks ORDER BY id DESC",
    };
    let sql = sql.replace("{cols}", TASK_COLS);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], row_to_task)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTask {
    pub title: String,
    pub note: Option<String>,
    pub category_id: Option<i64>,
    pub priority: Option<String>,
    pub due_at: Option<String>,
    pub remind_at: Option<String>,
    /// 直接进入排期而非收件箱
    pub scheduled: bool,
    pub source: Option<String>,
    pub external_id: Option<String>,
}

#[tauri::command]
pub fn create_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    task: NewTask,
) -> AppResult<Task> {
    let title = task.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Invalid("标题不能为空".into()));
    }
    let conn = db.0.lock().unwrap();
    let status = if task.scheduled { "scheduled" } else { "inbox" };
    conn.execute(
        "INSERT INTO tasks (title, note, category_id, status, priority, due_at, remind_at, source, external_id, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            title,
            task.note,
            task.category_id.unwrap_or(1),
            status,
            task.priority.as_deref().unwrap_or("normal"),
            task.due_at,
            task.remind_at,
            task.source.as_deref().unwrap_or("local"),
            task.external_id,
            now()
        ],
    )?;
    let id = conn.last_insert_rowid();
    let t = query_task(&conn, id)?;
    drop(conn);
    events::broadcast(&app, events::TASKS_CHANGED);
    Ok(t)
}

fn query_task(conn: &Connection, id: i64) -> AppResult<Task> {
    conn.query_row(
        &format!("SELECT {TASK_COLS} FROM tasks WHERE id=?1"),
        params![id],
        row_to_task,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("任务 {id} 不存在")),
        other => AppError::Db(other),
    })
}

#[tauri::command]
pub fn get_task(db: State<Db>, id: i64) -> AppResult<Task> {
    query_task(&db.0.lock().unwrap(), id)
}

/// 保留显式 null：缺失走 serde 默认（None），null 变 Some(Value::Null)，其余透传
fn keep_null<'de, D>(deserializer: D) -> Result<Option<serde_json::Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Some(
        <serde_json::Value as serde::Deserialize>::deserialize(deserializer)?,
    ))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    pub id: i64,
    pub title: Option<String>,
    pub note: Option<String>,
    pub category_id: Option<i64>,
    pub priority: Option<String>,
    /// JSON null = 清空，字符串 = 设置，字段缺失 = 不改
    #[serde(default, deserialize_with = "keep_null")]
    pub due_at: Option<serde_json::Value>,
    #[serde(default, deserialize_with = "keep_null")]
    pub remind_at: Option<serde_json::Value>,
    pub status: Option<String>,
}

/// due/remind 三态：不改（缺失）/ 清空（null）/ 设置（字符串）
#[tauri::command]
pub fn update_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    patch: TaskPatch,
) -> AppResult<Task> {
    let conn = db.0.lock().unwrap();
    let mut sets: Vec<String> = vec![];
    let mut p: Vec<Box<dyn rusqlite::types::ToSql>> = vec![];
    let push = |sets: &mut Vec<String>,
                p: &mut Vec<Box<dyn rusqlite::types::ToSql>>,
                col: &str,
                v: Box<dyn rusqlite::types::ToSql>| {
        sets.push(format!("{col}=?{}", p.len() + 1));
        p.push(v);
    };
    if let Some(v) = &patch.title {
        push(&mut sets, &mut p, "title", Box::new(v.clone()));
    }
    if let Some(v) = &patch.note {
        push(&mut sets, &mut p, "note", Box::new(v.clone()));
    }
    if let Some(v) = patch.category_id {
        push(&mut sets, &mut p, "category_id", Box::new(v));
    }
    if let Some(v) = &patch.priority {
        push(&mut sets, &mut p, "priority", Box::new(v));
    }
    if let Some(v) = &patch.due_at {
        let s = v.as_str().map(String::from);
        push(&mut sets, &mut p, "due_at", Box::new(s));
    }
    if let Some(v) = &patch.remind_at {
        let s = v.as_str().map(String::from);
        push(&mut sets, &mut p, "remind_at", Box::new(s));
        // 提醒时间变化后重置提醒标志
        push(&mut sets, &mut p, "reminded", Box::new(0i64));
    }
    if patch.status.as_deref() == Some("done") {
        push(&mut sets, &mut p, "completed_at", Box::new(now()));
    }
    if let Some(v) = &patch.status {
        push(&mut sets, &mut p, "status", Box::new(v.clone()));
    }
    p.push(Box::new(patch.id));
    let sql = format!("UPDATE tasks SET {} WHERE id=?{}", sets.join(", "), p.len());
    conn.execute(
        &sql,
        rusqlite::params_from_iter(p.iter().map(|b| b.as_ref())),
    )?;
    let t = query_task(&conn, patch.id)?;
    drop(conn);
    events::broadcast(&app, events::TASKS_CHANGED);
    Ok(t)
}

#[tauri::command]
pub fn delete_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
) -> AppResult<()> {
    db.0.lock()
        .unwrap()
        .execute("DELETE FROM tasks WHERE id=?1", params![id])?;
    events::broadcast(&app, events::TASKS_CHANGED);
    Ok(())
}

// ---- 专注模式：全局唯一 active 任务 ----

/// 开始一个任务：其它 active/paused 全部转回 scheduled，本任务置为 active
#[tauri::command]
pub fn start_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
) -> AppResult<Task> {
    {
        let mut conn = db.0.lock().unwrap();
        let tx = conn.transaction()?;
        tx.execute(
            "UPDATE tasks SET status='scheduled' WHERE status IN ('active','paused')",
            [],
        )?;
        tx.execute("UPDATE tasks SET status='active' WHERE id=?1", params![id])?;
        tx.commit()?;
    }
    let t = query_task(&db.0.lock().unwrap(), id)?;
    events::broadcast(&app, events::TASKS_CHANGED);
    Ok(t)
}

#[tauri::command]
pub fn pause_current_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
) -> AppResult<Option<Task>> {
    let t = {
        let conn = db.0.lock().unwrap();
        conn.execute("UPDATE tasks SET status='paused' WHERE status='active'", [])?;
        conn.query_row(
            &format!("SELECT {TASK_COLS} FROM tasks WHERE status='paused' ORDER BY focus_seconds DESC LIMIT 1"),
            [],
            row_to_task,
        )
        .ok()
    };
    events::broadcast(&app, events::TASKS_CHANGED);
    Ok(t)
}

#[tauri::command]
pub fn get_current_task(db: State<Db>) -> AppResult<Option<Task>> {
    let conn = db.0.lock().unwrap();
    let t = conn
        .query_row(
            &format!("SELECT {TASK_COLS} FROM tasks WHERE status='active' LIMIT 1"),
            [],
            row_to_task,
        )
        .ok();
    Ok(t)
}

/// 前端番茄钟每分钟上报专注时长
#[tauri::command]
pub fn add_focus_seconds(db: State<Db>, id: i64, seconds: i64) -> AppResult<()> {
    db.0.lock().unwrap().execute(
        "UPDATE tasks SET focus_seconds = focus_seconds + ?2 WHERE id=?1",
        params![id, seconds],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::windows::PendingMainReopen;
    use crate::db::tests::test_conn;
    use crate::db::Db;
    use std::sync::Mutex;
    use tauri::Manager;

    /// mock 运行时 + 内存库，直接以 State<Db> 调用命令函数
    fn setup() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(Db(Mutex::new(test_conn())));
        app.manage(PendingMainReopen(std::sync::atomic::AtomicBool::new(false)));
        app
    }

    fn new_task(title: &str, scheduled: bool) -> NewTask {
        NewTask {
            title: title.into(),
            note: None,
            category_id: None,
            priority: None,
            due_at: None,
            remind_at: None,
            scheduled,
            source: None,
            external_id: None,
        }
    }

    fn create(app: &tauri::App<tauri::test::MockRuntime>, title: &str, scheduled: bool) -> Task {
        let db = app.state::<Db>();
        create_task(app.handle().clone(), db, new_task(title, scheduled)).expect("create_task")
    }

    fn list(app: &tauri::App<tauri::test::MockRuntime>, filter: &str) -> Vec<Task> {
        let db = app.state::<Db>();
        list_tasks(db, filter.into()).expect("list_tasks")
    }

    /// 两窗口状态同步依赖命令广播事件：任务/设置变更必须发对应事件
    #[test]
    fn mutations_broadcast_change_events() {
        use std::sync::mpsc;
        use tauri::Listener;

        let app = setup();
        let (task_tx, task_rx) = mpsc::channel::<String>();
        let (set_tx, set_rx) = mpsc::channel::<String>();
        let handle = app.handle().clone();
        let t1 = task_tx.clone();
        handle.listen(events::TASKS_CHANGED, move |_| {
            t1.send("tasks".into()).unwrap();
        });
        handle.listen(events::SETTINGS_CHANGED, move |_| {
            set_tx.send("settings".into()).unwrap();
        });

        let t = create(&app, "广播", true);
        {
            let db = app.state::<Db>();
            start_task(handle.clone(), db, t.id).expect("start");
        }
        {
            let db = app.state::<Db>();
            crate::commands::settings::set_setting(
                handle.clone(),
                db,
                "language".into(),
                "en".into(),
            )
            .unwrap();
        }
        // 未变更数据的只读命令不应发事件
        {
            let db = app.state::<Db>();
            let _ = get_current_task(db);
        }
        drop(task_tx);

        let mut got = vec![];
        while let Ok(ev) = task_rx.recv_timeout(std::time::Duration::from_millis(200)) {
            got.push(ev);
        }
        assert!(
            got.len() >= 2,
            "create 与 start 均应广播 tasks-changed: {got:?}"
        );
        assert!(
            set_rx
                .recv_timeout(std::time::Duration::from_millis(200))
                .is_ok(),
            "set_setting 应广播 settings-changed"
        );
    }

    #[test]
    fn create_task_defaults_to_inbox_and_normal_priority() {
        let app = setup();
        let t = create(&app, "写周报", false);
        assert_eq!(t.status, "inbox");
        assert_eq!(t.priority, "normal");
        assert_eq!(t.source, "local");
        assert_eq!(t.category_id, 1);
        assert_eq!(t.focus_seconds, 0);
        assert!(!t.reminded);
    }

    #[test]
    fn create_task_scheduled_goes_to_route() {
        let app = setup();
        let t = create(&app, "开会", true);
        assert_eq!(t.status, "scheduled");
    }

    #[test]
    fn create_task_empty_title_rejected() {
        let app = setup();
        let db = app.state::<Db>();
        let err = create_task(app.handle().clone(), db.clone(), new_task("  ", false)).unwrap_err();
        assert_eq!(err.to_string(), "输入无效: 标题不能为空");
    }

    #[test]
    fn list_tasks_open_orders_active_first() {
        let app = setup();
        let a = create(&app, "A", true);
        let b = create(&app, "B", true);
        {
            let db = app.state::<Db>();
            start_task(app.handle().clone(), db, b.id).expect("start");
        }
        let open = list(&app, "open");
        assert_eq!(open[0].id, b.id, "active 任务排最前");
        assert_eq!(open[1].id, a.id);
        assert!(open.iter().all(|t| t.status != "done"));
    }

    #[test]
    fn list_tasks_done_only_returns_completed() {
        let app = setup();
        let t = create(&app, "已完成", true);
        {
            let db = app.state::<Db>();
            update_task(
                app.handle().clone(),
                db,
                TaskPatch {
                    id: t.id,
                    title: None,
                    note: None,
                    category_id: None,
                    priority: None,
                    due_at: None,
                    remind_at: None,
                    status: Some("done".into()),
                },
            )
            .expect("update");
        }
        let done = list(&app, "done");
        assert_eq!(done.len(), 1);
        assert_eq!(done[0].id, t.id);
        assert!(done[0].completed_at.is_some(), "完成时写入 completed_at");
        assert!(list(&app, "open").is_empty());
    }

    #[test]
    fn list_tasks_today_includes_overdue_and_active_excludes_future() {
        let app = setup();
        let overdue = create(&app, "过期", true);
        let future = create(&app, "未来", true);
        let active = create(&app, "进行中", true);
        // 直接改库构造时间（绕过命令层，专注验证过滤 SQL）
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let past = (chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339();
            let future_dt = (chrono::Utc::now() + chrono::Duration::days(2)).to_rfc3339();
            conn.execute(
                "UPDATE tasks SET due_at=?1 WHERE id=?2",
                params![past, overdue.id],
            )
            .unwrap();
            conn.execute(
                "UPDATE tasks SET due_at=?1 WHERE id=?2",
                params![future_dt, future.id],
            )
            .unwrap();
        }
        {
            let db = app.state::<Db>();
            start_task(app.handle().clone(), db, active.id).expect("start");
        }
        let today = list(&app, "today");
        let ids: Vec<i64> = today.iter().map(|t| t.id).collect();
        assert!(ids.contains(&overdue.id), "过期任务算今天");
        assert!(ids.contains(&active.id), "active 任务算今天");
        assert!(!ids.contains(&future.id), "未来任务不算今天");
    }

    #[test]
    fn update_task_partial_patch_keeps_other_fields() {
        let app = setup();
        let t = create(&app, "原标题", true);
        {
            let db = app.state::<Db>();
            update_task(
                app.handle().clone(),
                db,
                TaskPatch {
                    id: t.id,
                    title: Some("新标题".into()),
                    note: None,
                    category_id: None,
                    priority: Some("high".into()),
                    due_at: None,
                    remind_at: None,
                    status: None,
                },
            )
            .expect("update");
        }
        let got = {
            let db = app.state::<Db>();
            get_task(db, t.id).expect("get")
        };
        assert_eq!(got.title, "新标题");
        assert_eq!(got.priority, "high");
        assert_eq!(got.status, "scheduled", "未指定 status 不变");
    }

    #[test]
    fn update_task_remind_change_resets_reminded_flag() {
        let app = setup();
        let t = create(&app, "提醒", true);
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute("UPDATE tasks SET reminded=1 WHERE id=?1", params![t.id])
                .unwrap();
        }
        {
            let db = app.state::<Db>();
            update_task(
                app.handle().clone(),
                db,
                TaskPatch {
                    id: t.id,
                    title: None,
                    note: None,
                    category_id: None,
                    priority: None,
                    due_at: None,
                    remind_at: Some(serde_json::Value::String("2026-10-01T09:00".into())),
                    status: None,
                },
            )
            .expect("update");
        }
        let got = {
            let db = app.state::<Db>();
            get_task(db, t.id).expect("get")
        };
        assert!(!got.reminded, "改提醒时间后重置提醒标志");
        assert_eq!(got.remind_at.as_deref(), Some("2026-10-01T09:00"));
    }

    #[test]
    fn update_missing_task_returns_not_found_kind() {
        let app = setup();
        let db = app.state::<Db>();
        let patch: TaskPatch =
            serde_json::from_value(serde_json::json!({ "id": 9999, "title": "幽灵" })).unwrap();
        let err = update_task(app.handle().clone(), db, patch).unwrap_err();
        assert!(
            matches!(err, crate::error::AppError::NotFound(_)),
            "应返回 not_found 而非裸 db 错误: {err}"
        );
    }

    #[test]
    fn start_task_is_globally_unique() {
        let app = setup();
        let a = create(&app, "A", true);
        let b = create(&app, "B", true);
        {
            let db = app.state::<Db>();
            start_task(app.handle().clone(), db, a.id).expect("start a");
        }
        let current = {
            let db = app.state::<Db>();
            start_task(app.handle().clone(), db, b.id).expect("start b")
        };
        assert_eq!(current.status, "active");
        let open = list(&app, "open");
        let a_row = open.iter().find(|t| t.id == a.id).unwrap();
        assert_eq!(a_row.status, "scheduled", "切换后旧 active 回到 scheduled");
    }

    #[test]
    fn pause_and_get_current_task() {
        let app = setup();
        let t = create(&app, "专注", true);
        {
            let db = app.state::<Db>();
            start_task(app.handle().clone(), db, t.id).expect("start");
        }
        let paused = {
            let db = app.state::<Db>();
            pause_current_task(app.handle().clone(), db).expect("pause")
        };
        assert_eq!(paused.unwrap().id, t.id);
        let none: Option<Task> = {
            let db = app.state::<Db>();
            get_current_task(db).expect("get_current")
        };
        assert!(none.is_none(), "暂停后没有 active 任务");
        assert_eq!(list(&app, "open")[0].status, "paused");
    }

    #[test]
    fn add_focus_seconds_accumulates() {
        let app = setup();
        let t = create(&app, "计时", true);
        {
            let db = app.state::<Db>();
            add_focus_seconds(db.clone(), t.id, 60).unwrap();
            add_focus_seconds(db, t.id, 30).unwrap();
        }
        let got = {
            let db = app.state::<Db>();
            get_task(db, t.id).unwrap()
        };
        assert_eq!(got.focus_seconds, 90);
    }

    #[test]
    fn delete_task_removes_row() {
        let app = setup();
        let t = create(&app, "待删", true);
        {
            let db = app.state::<Db>();
            delete_task(app.handle().clone(), db, t.id).unwrap();
        }
        let err = {
            let db = app.state::<Db>();
            get_task(db, t.id)
        };
        assert!(err.is_err());
    }

    // ---- IPC 契约：前端 api.ts 以 camelCase 发送载荷 ----

    #[test]
    fn new_task_deserializes_from_frontend_payload() {
        let t: NewTask = serde_json::from_value(serde_json::json!({
            "title": "写周报",
            "categoryId": 2,
            "priority": "high",
            "dueAt": "2026-09-13T09:00",
            "scheduled": true
        }))
        .expect("前端载荷应可反序列化");
        assert_eq!(t.title, "写周报");
        assert_eq!(t.category_id, Some(2));
        assert_eq!(t.priority.as_deref(), Some("high"));
        assert_eq!(t.due_at.as_deref(), Some("2026-09-13T09:00"));
        assert!(t.scheduled);
    }

    #[test]
    fn task_patch_distinguishes_unset_clear_and_set() {
        // 字段缺失 = 不改
        let keep: TaskPatch =
            serde_json::from_value(serde_json::json!({ "id": 1, "title": "新" })).unwrap();
        assert!(keep.due_at.is_none());
        // dueAt: null = 清空（回归：serde 默认把 null 也读成 None，曾导致清空截止时间静默失效）
        let clear: TaskPatch =
            serde_json::from_value(serde_json::json!({ "id": 1, "dueAt": null })).unwrap();
        assert_eq!(clear.due_at, Some(serde_json::Value::Null));
        // 字符串 = 设置
        let set: TaskPatch =
            serde_json::from_value(serde_json::json!({ "id": 1, "dueAt": "2026-10-01T09:00" }))
                .unwrap();
        assert_eq!(
            set.due_at,
            Some(serde_json::Value::String("2026-10-01T09:00".into()))
        );
    }

    #[test]
    fn update_task_clears_due_at_via_null() {
        let app = setup();
        let t = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO tasks (title, status, due_at, created_at) VALUES ('清空', 'inbox', '2026-09-10T09:00', '2026-09-01T00:00:00Z')",
                [],
            )
            .unwrap();
            conn.last_insert_rowid()
        };
        {
            let db = app.state::<Db>();
            let patch: TaskPatch = serde_json::from_value(
                serde_json::json!({ "id": t, "dueAt": null, "status": "scheduled" }),
            )
            .unwrap();
            update_task(app.handle().clone(), db, patch).expect("update");
        }
        let got = {
            let db = app.state::<Db>();
            get_task(db, t).expect("get")
        };
        assert_eq!(got.due_at, None, "dueAt: null 应清空截止时间");
        assert_eq!(got.status, "scheduled");
    }
}
