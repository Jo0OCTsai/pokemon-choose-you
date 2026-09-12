use crate::db::{now, Db};
use crate::models::{Category, ImSuggestion, Task};
use rusqlite::{params, Connection};
use tauri::{Emitter, Manager, State};

/// 数据变更广播：主面板与桌宠是两个独立窗口，靠这些事件保持状态一致
/// （ emitting 放在写库成功之后，前端收到事件后各自重新拉取 ）
fn broadcast<R: tauri::Runtime>(app: &tauri::AppHandle<R>, event: &str) {
    let _ = app.emit(event, ());
}

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
pub fn list_tasks(db: State<Db>, filter: String) -> Result<Vec<Task>, String> {
    let conn = db.0.lock().unwrap();
    let (sql, ok_statuses): (String, Vec<String>) = match filter.as_str() {
        "open" => (
            "SELECT {cols} FROM tasks WHERE status IN ('inbox','scheduled','active','paused') ORDER BY
                CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'scheduled' THEN 2 ELSE 3 END,
                CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                due_at IS NULL, due_at"
                .to_string(),
            vec![],
        ),
        "done" => ("SELECT {cols} FROM tasks WHERE status='done' ORDER BY completed_at DESC LIMIT 200".to_string(), vec![]),
        "today" => (
            "SELECT {cols} FROM tasks WHERE status IN ('inbox','scheduled','active','paused')
             AND (due_at IS NOT NULL AND date(due_at) <= date('now','localtime') OR status IN ('active','paused'))
             ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END".to_string(),
            vec![],
        ),
        _ => ("SELECT {cols} FROM tasks ORDER BY id DESC".to_string(), vec![]),
    };
    let _ = ok_statuses;
    let sql = sql.replace("{cols}", TASK_COLS);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_to_task)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
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
pub fn create_task<R: tauri::Runtime>(app: tauri::AppHandle<R>, db: State<Db>, task: NewTask) -> Result<Task, String> {
    let conn = db.0.lock().unwrap();
    let status = if task.scheduled { "scheduled" } else { "inbox" };
    conn.execute(
        "INSERT INTO tasks (title, note, category_id, status, priority, due_at, remind_at, source, external_id, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            task.title,
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
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    let t = query_task(&conn, id)?;
    drop(conn);
    broadcast(&app, "tasks-changed");
    Ok(t)
}

fn query_task(conn: &Connection, id: i64) -> Result<Task, String> {
    conn.query_row(
        &format!("SELECT {TASK_COLS} FROM tasks WHERE id=?1"),
        params![id],
        row_to_task,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_task(db: State<Db>, id: i64) -> Result<Task, String> {
    query_task(&db.0.lock().unwrap(), id)
}

/// 保留显式 null：缺失走 serde 默认（None），null 变 Some(Value::Null)，其余透传
fn keep_null<'de, D>(deserializer: D) -> Result<Option<serde_json::Value>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(Some(<serde_json::Value as serde::Deserialize>::deserialize(deserializer)?))
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
pub fn update_task<R: tauri::Runtime>(app: tauri::AppHandle<R>, db: State<Db>, patch: TaskPatch) -> Result<Task, String> {
    let conn = db.0.lock().unwrap();
    let mut sets: Vec<String> = vec![];
    let mut p: Vec<Box<dyn rusqlite::types::ToSql>> = vec![];
    let push = |sets: &mut Vec<String>, p: &mut Vec<Box<dyn rusqlite::types::ToSql>>, col: &str, v: Box<dyn rusqlite::types::ToSql>| {
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
        // 提醒时间变化后重置提醒标记
        push(&mut sets, &mut p, "reminded", Box::new(0i64));
    }
    if patch.status.as_deref() == Some("done") {
        push(&mut sets, &mut p, "completed_at", Box::new(now()));
    }
    if let Some(v) = &patch.status {
        push(&mut sets, &mut p, "status", Box::new(v.clone()));
    }
    p.push(Box::new(patch.id));
    let sql = format!(
        "UPDATE tasks SET {} WHERE id=?{}",
        sets.join(", "),
        p.len()
    );
    conn.execute(&sql, rusqlite::params_from_iter(p.iter().map(|b| b.as_ref())))
        .map_err(|e| e.to_string())?;
    let t = query_task(&conn, patch.id)?;
    drop(conn);
    broadcast(&app, "tasks-changed");
    Ok(t)
}

#[tauri::command]
pub fn delete_task<R: tauri::Runtime>(app: tauri::AppHandle<R>, db: State<Db>, id: i64) -> Result<(), String> {
    db.0.lock()
        .unwrap()
        .execute("DELETE FROM tasks WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    broadcast(&app, "tasks-changed");
    Ok(())
}

// ---- 专注模式：全局唯一 active 任务 ----

/// 开始一个任务：其它 active/paused 全部转回 scheduled，本任务置为 active
#[tauri::command]
pub fn start_task<R: tauri::Runtime>(app: tauri::AppHandle<R>, db: State<Db>, id: i64) -> Result<Task, String> {
    let mut conn = db.0.lock().unwrap();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute("UPDATE tasks SET status='scheduled' WHERE status IN ('active','paused')", [])
        .map_err(|e| e.to_string())?;
    tx.execute("UPDATE tasks SET status='active' WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    drop(conn);
    let t = get_task_by_id(&db, id)?;
    broadcast(&app, "tasks-changed");
    Ok(t)
}

fn get_task_by_id(db: &State<Db>, id: i64) -> Result<Task, String> {
    query_task(&db.0.lock().unwrap(), id)
}

#[tauri::command]
pub fn pause_current_task<R: tauri::Runtime>(app: tauri::AppHandle<R>, db: State<Db>) -> Result<Option<Task>, String> {
    let conn = db.0.lock().unwrap();
    conn.execute("UPDATE tasks SET status='paused' WHERE status='active'", [])
        .map_err(|e| e.to_string())?;
    let t = conn
        .query_row(
            &format!("SELECT {TASK_COLS} FROM tasks WHERE status='paused' ORDER BY focus_seconds DESC LIMIT 1"),
            [],
            row_to_task,
        )
        .ok();
    drop(conn);
    broadcast(&app, "tasks-changed");
    Ok(t)
}

#[tauri::command]
pub fn get_current_task(db: State<Db>) -> Result<Option<Task>, String> {
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
pub fn add_focus_seconds(db: State<Db>, id: i64, seconds: i64) -> Result<(), String> {
    db.0.lock()
        .unwrap()
        .execute(
            "UPDATE tasks SET focus_seconds = focus_seconds + ?2 WHERE id=?1",
            params![id, seconds],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---- 分类 ----

#[tauri::command]
pub fn list_categories(db: State<Db>) -> Result<Vec<Category>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, name, pokemon, sprite FROM categories ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Category {
                id: r.get(0)?,
                name: r.get(1)?,
                pokemon: r.get(2)?,
                sprite: r.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

#[tauri::command]
pub fn set_category_pokemon<R: tauri::Runtime>(app: tauri::AppHandle<R>, db: State<Db>, id: i64, pokemon: String, sprite: String) -> Result<(), String> {
    db.0.lock()
        .unwrap()
        .execute(
            "UPDATE categories SET pokemon=?2, sprite=?3 WHERE id=?1",
            params![id, pokemon, sprite],
        )
        .map_err(|e| e.to_string())?;
    broadcast(&app, "categories-changed");
    Ok(())
}

// ---- 设置 ----

#[tauri::command]
pub fn get_setting(db: State<Db>, key: String) -> Result<Option<String>, String> {
    let conn = db.0.lock().unwrap();
    let v = conn
        .query_row("SELECT value FROM settings WHERE key=?1", params![key], |r| {
            r.get::<_, String>(0)
        })
        .ok();
    Ok(v)
}

#[tauri::command]
pub fn set_setting<R: tauri::Runtime>(app: tauri::AppHandle<R>, db: State<Db>, key: String, value: String) -> Result<(), String> {
    db.0.lock()
        .unwrap()
        .execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2",
            params![key, value],
        )
        .map_err(|e| e.to_string())?;
    broadcast(&app, "settings-changed");
    Ok(())
}

// ---- IM 收件箱（M4 填充数据，这里提供审核命令） ----

#[tauri::command]
pub fn list_im_suggestions(db: State<Db>, status: Option<String>) -> Result<Vec<ImSuggestion>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, message_id, chat_name, sender, content, suggested_title, suggested_category, suggested_due, review_status, created_at
                  FROM im_suggestions WHERE (?1 IS NULL OR review_status=?1) ORDER BY id DESC LIMIT 300")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![status], |r| {
            Ok(ImSuggestion {
                id: r.get(0)?,
                message_id: r.get(1)?,
                chat_name: r.get(2)?,
                sender: r.get(3)?,
                content: r.get(4)?,
                suggested_title: r.get(5)?,
                suggested_category: r.get(6)?,
                suggested_due: r.get(7)?,
                review_status: r.get(8)?,
                created_at: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// 接受建议 -> 创建任务并标记已处理
#[tauri::command]
pub fn accept_im_suggestion<R: tauri::Runtime>(app: tauri::AppHandle<R>, db: State<Db>, id: i64) -> Result<i64, String> {
    let conn = db.0.lock().unwrap();
    let sug: (String, Option<String>) = conn
        .query_row(
            "SELECT content, suggested_title FROM im_suggestions WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let title = sug.1.unwrap_or_else(|| sug.0.chars().take(40).collect());
    conn.execute(
        "INSERT INTO tasks (title, category_id, status, source, created_at) VALUES (?1, 1, 'inbox', 'feishu', ?2)",
        params![title, now()],
    )
    .map_err(|e| e.to_string())?;
    let task_id = conn.last_insert_rowid();
    conn.execute(
        "UPDATE im_suggestions SET review_status='accepted' WHERE id=?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    drop(conn);
    broadcast(&app, "tasks-changed");
    Ok(task_id)
}

#[tauri::command]
pub fn dismiss_im_suggestion<R: tauri::Runtime>(app: tauri::AppHandle<R>, db: State<Db>, id: i64) -> Result<(), String> {
    db.0.lock()
        .unwrap()
        .execute("UPDATE im_suggestions SET review_status='dismissed' WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    broadcast(&app, "im-suggestions-changed");
    Ok(())
}

// ---- 集成：AI / 飞书 / Todoist ----

#[tauri::command]
pub async fn test_ai_config(db: State<'_, Db>) -> Result<String, String> {
    let get = |k: &str| -> Option<String> {
        let conn = db.0.lock().unwrap();
        conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| r.get::<_, String>(0)).ok()
    };
    let cfg = crate::ai::load_config(&get).ok_or("请先填写 AI Base URL 和 API Key")?;
    crate::ai::test(&cfg).await
}

#[tauri::command]
pub async fn test_feishu_config(db: State<'_, Db>) -> Result<String, String> {
    let get = |k: &str| -> Option<String> {
        let conn = db.0.lock().unwrap();
        conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| r.get::<_, String>(0)).ok()
    };
    let cfg = crate::feishu::load_config(&get).ok_or("请先填写飞书 App ID / App Secret")?;
    crate::feishu::poll_once_test(&cfg).await
}

#[tauri::command]
pub async fn trigger_feishu_poll(app: tauri::AppHandle) -> Result<usize, String> {
    crate::feishu::poll_once(&app).await
}

#[tauri::command]
pub async fn sync_todoist(app: tauri::AppHandle) -> Result<String, String> {
    crate::todoist::sync(&app).await
}

#[tauri::command]
pub fn list_all_settings(db: State<Db>) -> Result<std::collections::HashMap<String, String>, String> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare("SELECT key, value FROM settings").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<std::collections::HashMap<_, _>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

// ---- 分类管理 ----

/// 桌宠请求重开主窗口的标记（Linux 销毁重建路径用），启动时 manage 进应用状态
pub struct PendingMainReopen(pub std::sync::atomic::AtomicBool);

/// main 窗口 Destroyed 时由 lib.rs 的 run 回调调用：有挂起请求才重建，用户自己关闭不重建。
/// 该回调收到 Destroyed 时 label 已从管理器注销，此处建新窗口无同名冲突。
pub fn reopen_main_if_pending<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use std::sync::atomic::Ordering;
    if !app.state::<PendingMainReopen>().0.swap(false, Ordering::SeqCst) {
        return;
    }
    if let Err(e) = build_main_window(app) {
        log::error!("[open_main_window] 销毁后重建失败: {e}");
    }
}

/// 双击桌宠打开主窗口。Windows/macOS：存在则恢复（含最小化）并置前；
/// Linux（WSLg/Wayland）：最小化状态在应用侧失真、Wayland 又不允许客户端自行激活窗口，
/// 强制重映射会冻住标题栏按钮，因此统一销毁重建（状态都在库里，重建即恢复）。
#[tauri::command]
pub fn open_main_window<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        #[cfg(target_os = "linux")]
        {
            use std::sync::atomic::Ordering;
            log::info!("[open_main_window] linux 销毁重建（最小化探测失真: {}）", win.is_minimized().unwrap_or(false));
            match win.destroy() {
                Ok(()) => app.state::<PendingMainReopen>().0.store(true, Ordering::SeqCst),
                Err(e) => log::warn!("[open_main_window] destroy 失败: {e}"),
            }
            // 重建在 run 事件的 Destroyed 回调（reopen_main_if_pending）里完成
        }
        #[cfg(not(target_os = "linux"))]
        {
            // 最小化的窗口 set_focus 是 no-op，必须先恢复；
            // 盲目 restore 会顺带取消最大化，需先探测
            if win.is_minimized().unwrap_or(false) {
                let _ = win.unminimize();
            }
            win.show().map_err(|e| e.to_string())?;
            let _ = win.set_focus();
        }
    } else {
        build_main_window(&app)?;
    }
    Ok(())
}

fn build_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("宝可梦来敲门")
    .inner_size(980.0, 700.0)
    .min_inner_size(760.0, 540.0)
    .build()
    .map_err(|e| e.to_string())
    .map(|_| ())
}

#[tauri::command]
pub fn create_category<R: tauri::Runtime>(app: tauri::AppHandle<R>, db: State<Db>, name: String, pokemon: String, sprite: String) -> Result<Category, String> {
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO categories (name, pokemon, sprite) VALUES (?1, ?2, ?3)",
        params![name, pokemon, sprite],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    drop(conn);
    broadcast(&app, "categories-changed");
    Ok(Category { id, name, pokemon, sprite })
}

#[tauri::command]
pub fn update_category<R: tauri::Runtime>(app: tauri::AppHandle<R>, db: State<Db>, id: i64, name: String, pokemon: String, sprite: String) -> Result<(), String> {
    db.0.lock()
        .unwrap()
        .execute(
            "UPDATE categories SET name=?2, pokemon=?3, sprite=?4 WHERE id=?1",
            params![id, name, pokemon, sprite],
        )
        .map_err(|e| e.to_string())?;
    broadcast(&app, "categories-changed");
    Ok(())
}

/// 删除分类：其下任务移回第一个分类；不允许删除最后一个分类
#[tauri::command]
pub fn delete_category<R: tauri::Runtime>(app: tauri::AppHandle<R>, db: State<Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if count <= 1 {
        return Err("至少保留一个分类".into());
    }
    let fallback: i64 = conn
        .query_row("SELECT id FROM categories WHERE id != ?1 ORDER BY id LIMIT 1", params![id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    conn.execute("UPDATE tasks SET category_id=?2 WHERE category_id=?1", params![id, fallback])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM categories WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    drop(conn);
    broadcast(&app, "categories-changed");
    broadcast(&app, "tasks-changed");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
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
        handle.listen("tasks-changed", move |_| { t1.send("tasks".into()).unwrap(); });
        handle.listen("settings-changed", move |_| { set_tx.send("settings".into()).unwrap(); });

        let t = create(&app, "广播", true);
        {
            let db = app.state::<Db>();
            start_task(handle.clone(), db, t.id).expect("start");
        }
        {
            let db = app.state::<Db>();
            set_setting(handle.clone(), db, "language".into(), "en".into()).unwrap();
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
        assert!(got.len() >= 2, "create 与 start 均应广播 tasks-changed: {got:?}");
        assert!(set_rx.recv_timeout(std::time::Duration::from_millis(200)).is_ok(), "set_setting 应广播 settings-changed");
    }

    /// 双击桌宠打开主窗口：不存在时直接重建；存在时（Linux）销毁并挂起重开，
    /// 重建由 Destroyed 事件回调（reopen_main_if_pending）完成，用户自行关闭不触发重建
    #[test]
    fn open_main_window_rebuilds_and_marks_reopen() {
        use std::sync::atomic::Ordering;
        let app = setup();
        assert!(app.get_webview_window("main").is_none(), "mock 初始没有 main 窗口");
        open_main_window(app.handle().clone()).expect("首次调用走重建分支");
        assert!(app.get_webview_window("main").is_some(), "关闭后应重建 main 窗口");
        // 再次调用（窗口存在）：销毁并挂起重开；mock 不驱动事件循环，Destroyed 回调由下方手动模拟
        open_main_window(app.handle().clone()).expect("再次调用销毁旧窗口");
        assert!(
            app.state::<PendingMainReopen>().0.load(Ordering::SeqCst),
            "应挂起重开请求"
        );
        reopen_main_if_pending(app.handle());
        assert!(
            !app.state::<PendingMainReopen>().0.load(Ordering::SeqCst),
            "Destroyed 回调应消费标记"
        );
        // 用户自行关闭（无挂起请求）时再次进入回调，不应触发重建
        reopen_main_if_pending(app.handle());
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
    fn list_tasks_open_orders_active_first() {
        let app = setup();
        let a = create(&app, "A", true);
        let b = create(&app, "B", true);
        {
            let db = app.state::<Db>();
            start_task(app.handle().clone(), db,b.id).expect("start");
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
                TaskPatch { id: t.id, title: None, note: None, category_id: None, priority: None, due_at: None, remind_at: None, status: Some("done".into()) },
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
            conn.execute("UPDATE tasks SET due_at=?1 WHERE id=?2", params![past, overdue.id]).unwrap();
            conn.execute("UPDATE tasks SET due_at=?1 WHERE id=?2", params![future_dt, future.id]).unwrap();
        }
        {
            let db = app.state::<Db>();
            start_task(app.handle().clone(), db,active.id).expect("start");
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
                TaskPatch { id: t.id, title: Some("新标题".into()), note: None, category_id: None, priority: Some("high".into()), due_at: None, remind_at: None, status: None },
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
            conn.execute("UPDATE tasks SET reminded=1 WHERE id=?1", params![t.id]).unwrap();
        }
        {
            let db = app.state::<Db>();
            update_task(
                app.handle().clone(),
                db,
                TaskPatch { id: t.id, title: None, note: None, category_id: None, priority: None, due_at: None, remind_at: Some(serde_json::Value::String("2026-10-01T09:00".into())), status: None },
            )
            .expect("update");
        }
        let got = {
            let db = app.state::<Db>();
            get_task(db, t.id).expect("get")
        };
        assert!(!got.reminded, "改提醒时间后重置提醒标记");
        assert_eq!(got.remind_at.as_deref(), Some("2026-10-01T09:00"));
    }

    #[test]
    fn start_task_is_globally_unique() {
        let app = setup();
        let a = create(&app, "A", true);
        let b = create(&app, "B", true);
        {
            let db = app.state::<Db>();
            start_task(app.handle().clone(), db,a.id).expect("start a");
        }
        let current = {
            let db = app.state::<Db>();
            start_task(app.handle().clone(), db,b.id).expect("start b")
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
            start_task(app.handle().clone(), db,t.id).expect("start");
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

    // ---- 分类 ----

    #[test]
    fn category_crud_and_reassignment() {
        let app = setup();
        let cat = {
            let db = app.state::<Db>();
            create_category(app.handle().clone(), db, "新分类".into(), "伊布".into(), "eevee".into()).unwrap()
        };
        assert!(cat.id > 6);
        {
            let db = app.state::<Db>();
            update_category(app.handle().clone(), db.clone(), cat.id, "改名".into(), "卡比兽".into(), "snorlax".into()).unwrap();
            set_category_pokemon(app.handle().clone(), db, cat.id, "皮卡丘".into(), "pikachu".into()).unwrap();
        }
        let t = create(&app, "归属新分类", true);
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute("UPDATE tasks SET category_id=?1 WHERE id=?2", params![cat.id, t.id]).unwrap();
        }
        {
            let db = app.state::<Db>();
            delete_category(app.handle().clone(), db, cat.id).unwrap();
        }
        let got = {
            let db = app.state::<Db>();
            get_task(db, t.id).unwrap()
        };
        assert_ne!(got.category_id, cat.id, "删除分类后任务被迁移");
        let cats = {
            let db = app.state::<Db>();
            list_categories(db).unwrap()
        };
        assert!(!cats.iter().any(|c| c.id == cat.id));
    }

    #[test]
    fn delete_last_category_rejected() {
        let app = setup();
        let cats = {
            let db = app.state::<Db>();
            list_categories(db).unwrap()
        };
        for c in cats {
            let db = app.state::<Db>();
            let _ = delete_category(app.handle().clone(), db, c.id);
        }
        let err = {
            let db = app.state::<Db>();
            delete_category(app.handle().clone(), db, 1)
        };
        assert!(err.is_err(), "至少保留一个分类");
    }

    // ---- 设置 ----

    #[test]
    fn settings_get_set_list() {
        let app = setup();
        {
            let db = app.state::<Db>();
            assert_eq!(get_setting(db.clone(), "language".into()).unwrap(), None);
            set_setting(app.handle().clone(), db, "language".into(), "en".into()).unwrap();
        }
        let all = {
            let db = app.state::<Db>();
            list_all_settings(db).unwrap()
        };
        assert_eq!(all.get("language").map(String::as_str), Some("en"));
    }

    // ---- IM 建议 ----

    fn seed_suggestion(app: &tauri::App<tauri::test::MockRuntime>) -> i64 {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO im_suggestions (message_id, chat_name, sender, content, suggested_title, review_status, created_at)
             VALUES ('m1', '群', '张三', '明天上午10点开周会', '参加周会', 'pending', '2026-09-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn im_suggestion_list_filter_and_accept() {
        let app = setup();
        let sid = seed_suggestion(&app);
        {
            let db = app.state::<Db>();
            let pending = list_im_suggestions(db, Some("pending".into())).unwrap();
            assert_eq!(pending.len(), 1);
            assert_eq!(pending[0].suggested_title.as_deref(), Some("参加周会"));
        }
        let task_id = {
            let db = app.state::<Db>();
            accept_im_suggestion(app.handle().clone(), db, sid).unwrap()
        };
        let task = {
            let db = app.state::<Db>();
            get_task(db, task_id).unwrap()
        };
        assert_eq!(task.title, "参加周会");
        assert_eq!(task.source, "feishu");
        assert_eq!(task.status, "inbox");
        {
            let db = app.state::<Db>();
            let pending = list_im_suggestions(db, Some("pending".into())).unwrap();
            assert!(pending.is_empty(), "接受后不再 pending");
        }
    }

    #[test]
    fn im_suggestion_accept_without_title_truncates_content() {
        let app = setup();
        let sid = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let long = "很长的消息".repeat(20);
            conn.execute(
                "INSERT INTO im_suggestions (message_id, chat_name, sender, content, suggested_title, review_status, created_at)
                 VALUES ('m2', '', '', ?1, NULL, 'pending', '2026-09-01T00:00:00Z')",
                params![long],
            )
            .unwrap();
            conn.last_insert_rowid()
        };
        let task_id = {
            let db = app.state::<Db>();
            accept_im_suggestion(app.handle().clone(), db, sid).unwrap()
        };
        let task = {
            let db = app.state::<Db>();
            get_task(db, task_id).unwrap()
        };
        assert_eq!(task.title.chars().count(), 40, "无建议标题时截取前 40 字");
    }

    #[test]
    fn im_suggestion_dismiss() {
        let app = setup();
        let sid = seed_suggestion(&app);
        {
            let db = app.state::<Db>();
            dismiss_im_suggestion(app.handle().clone(), db, sid).unwrap();
        }
        let dismissed = {
            let db = app.state::<Db>();
            list_im_suggestions(db, Some("dismissed".into())).unwrap()
        };
        assert_eq!(dismissed.len(), 1);
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
        let keep: TaskPatch = serde_json::from_value(serde_json::json!({ "id": 1, "title": "新" })).unwrap();
        assert!(keep.due_at.is_none());
        // dueAt: null = 清空（回归：serde 默认把 null 也读成 None，曾导致清空截止时间静默失效）
        let clear: TaskPatch = serde_json::from_value(serde_json::json!({ "id": 1, "dueAt": null })).unwrap();
        assert_eq!(clear.due_at, Some(serde_json::Value::Null));
        // 字符串 = 设置
        let set: TaskPatch = serde_json::from_value(serde_json::json!({ "id": 1, "dueAt": "2026-10-01T09:00" })).unwrap();
        assert_eq!(set.due_at, Some(serde_json::Value::String("2026-10-01T09:00".into())));
    }

    #[test]
    fn update_task_clears_due_at_via_null() {
        let app = setup();
        let t = commands_clear_seed(&app);
        {
            let db = app.state::<Db>();
            let patch: TaskPatch = serde_json::from_value(serde_json::json!({ "id": t, "dueAt": null, "status": "scheduled" })).unwrap();
            update_task(app.handle().clone(), db, patch).expect("update");
        }
        let got = {
            let db = app.state::<Db>();
            get_task(db, t).expect("get")
        };
        assert_eq!(got.due_at, None, "dueAt: null 应清空截止时间");
        assert_eq!(got.status, "scheduled");
    }

    fn commands_clear_seed(app: &tauri::App<tauri::test::MockRuntime>) -> i64 {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO tasks (title, status, due_at, created_at) VALUES ('清空', 'inbox', '2026-09-10T09:00', '2026-09-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.last_insert_rowid()
    }
}
