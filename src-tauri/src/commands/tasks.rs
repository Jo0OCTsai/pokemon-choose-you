use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::models::{Task, TaskLog, TaskNote};
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
        started_at: row.get(13)?,
        cancelled_at: row.get(14)?,
        focus_seconds: row.get(15)?,
        tags: vec![],
    })
}

/// 给任务列表批量挂标签（task_tags JOIN tags，逐任务小查询在本地库量级下足够）
fn attach_tags(conn: &Connection, tasks: &mut [Task]) -> AppResult<()> {
    let mut stmt = conn.prepare(
        "SELECT t.name FROM task_tags tt JOIN tags t ON t.id = tt.tag_id
         WHERE tt.task_id = ?1 ORDER BY t.id",
    )?;
    for t in tasks.iter_mut() {
        let names = stmt
            .query_map(params![t.id], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        t.tags = names;
    }
    Ok(())
}

const TASK_COLS: &str = "id, title, note, category_id, status, priority, due_at, remind_at, reminded, source, external_id, created_at, completed_at, started_at, cancelled_at, focus_seconds";

// ---- 图鉴页统计（成就页头：累计捕捉/逃走，全量口径不受列表 LIMIT 200 截断） ----

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DexStats {
    pub caught: i64,
    pub escaped: i64,
}

#[tauri::command]
pub fn dex_stats(db: State<Db>) -> AppResult<DexStats> {
    let conn = db.0.lock().unwrap();
    let (caught, escaped): (i64, i64) = conn.query_row(
        "SELECT COALESCE(SUM(status='done'), 0), COALESCE(SUM(status='cancelled'), 0) FROM tasks",
        [],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(DexStats { caught, escaped })
}

// ---- 操作日志（task_logs）：所有状态与属性变更的审计记录 ----

/// 写一条日志；field 无关的动作（create/delete 等）传空串。
/// 供 tauri 命令与 pk CLI（bin/pk.rs）两条入口共用。
pub fn log_change(
    conn: &Connection,
    task_id: i64,
    action: &str,
    field: &str,
    old: Option<&str>,
    new: Option<&str>,
    origin: &str,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO task_logs (task_id, action, field, old_value, new_value, origin, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![task_id, action, field, old, new, origin, now()],
    )?;
    Ok(())
}

/// 记录任务前后快照的字段级 diff（无变化不记），update_task 等通用修改路径复用
fn log_task_diff(conn: &Connection, before: &Task, after: &Task, origin: &str) -> AppResult<()> {
    let pairs: Vec<(&str, String, String)> = vec![
        ("title", before.title.clone(), after.title.clone()),
        (
            "note",
            before.note.clone().unwrap_or_default(),
            after.note.clone().unwrap_or_default(),
        ),
        (
            "category_id",
            before.category_id.to_string(),
            after.category_id.to_string(),
        ),
        ("priority", before.priority.clone(), after.priority.clone()),
        (
            "due_at",
            before.due_at.clone().unwrap_or_default(),
            after.due_at.clone().unwrap_or_default(),
        ),
        (
            "remind_at",
            before.remind_at.clone().unwrap_or_default(),
            after.remind_at.clone().unwrap_or_default(),
        ),
        ("status", before.status.clone(), after.status.clone()),
    ];
    for (field, old, new) in pairs {
        if old != new {
            log_change(
                conn,
                after.id,
                "update",
                field,
                Some(old.as_str()),
                Some(new.as_str()),
                origin,
            )?;
        }
    }
    if before.tags != after.tags {
        log_change(
            conn,
            after.id,
            "update",
            "tags",
            Some(&before.tags.join(",")),
            Some(&after.tags.join(",")),
            origin,
        )?;
    }
    Ok(())
}

/// 状态不变量：无截止时间且从未开始 → inbox（done/cancelled 天然不满足条件，不受影响）。
/// 任何写路径改完 status/due_at 后调用，保证草丛语义成立。
fn enforce_inbox_invariant(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute(
        "UPDATE tasks SET status='inbox'
         WHERE id=?1 AND status='scheduled' AND due_at IS NULL AND started_at IS NULL",
        params![id],
    )?;
    Ok(())
}

/// 命令层通用的变更来源：前端 api.call 会带上调用窗口 label（main / pet），
/// 后端链路（radio / todoist / migration）各自显式传入
fn origin_of(origin: Option<&str>) -> &str {
    match origin {
        Some(o) if !o.is_empty() => o,
        _ => "unknown",
    }
}

#[tauri::command]
pub fn list_tasks(db: State<Db>, filter: String) -> AppResult<Vec<Task>> {
    let conn = db.0.lock().unwrap();
    list_tasks_conn(&conn, &filter)
}

/// conn 版查询（pk CLI 复用）：open/done/today/其余全量
pub fn list_tasks_conn(conn: &Connection, filter: &str) -> AppResult<Vec<Task>> {
    let sql = match filter {
        "open" => "SELECT {cols} FROM tasks WHERE status IN ('inbox','scheduled','active','paused') ORDER BY
                CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'scheduled' THEN 2 ELSE 3 END,
                CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                due_at IS NULL, due_at",
        "done" => "SELECT {cols} FROM tasks WHERE status IN ('done','cancelled')
                ORDER BY COALESCE(completed_at, cancelled_at) DESC LIMIT 200",
        "today" => "SELECT {cols} FROM tasks WHERE status IN ('inbox','scheduled','active','paused')
             AND (due_at IS NOT NULL AND date(due_at) <= date('now','localtime') OR status IN ('active','paused'))
             ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END",
        _ => "SELECT {cols} FROM tasks ORDER BY id DESC",
    };
    let sql = sql.replace("{cols}", TASK_COLS);
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt
        .query_map([], row_to_task)?
        .collect::<Result<Vec<_>, _>>()?;
    attach_tags(conn, &mut rows)?;
    Ok(rows)
}

/// 关键词搜索：标题/备注/跟进记录/标签名，任意命中即返回
#[tauri::command]
pub fn search_tasks(db: State<Db>, q: String) -> AppResult<Vec<Task>> {
    let conn = db.0.lock().unwrap();
    search_tasks_conn(&conn, &q)
}

/// conn 版搜索（pk CLI 复用）
pub fn search_tasks_conn(conn: &Connection, q: &str) -> AppResult<Vec<Task>> {
    let q = q.trim().to_string();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let like = format!(
        "%{}%",
        q.replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let mut stmt = conn.prepare(&format!(
        "SELECT {TASK_COLS} FROM tasks
         WHERE title LIKE ?1 ESCAPE '\\'
            OR note LIKE ?1 ESCAPE '\\'
            OR id IN (SELECT tt.task_id FROM task_tags tt JOIN tags t ON t.id = tt.tag_id
                      WHERE t.name LIKE ?1 ESCAPE '\\')
            OR id IN (SELECT task_id FROM task_notes WHERE content LIKE ?1 ESCAPE '\\')
         ORDER BY id DESC LIMIT 100"
    ))?;
    let mut rows = stmt
        .query_map(params![like], row_to_task)?
        .collect::<Result<Vec<_>, _>>()?;
    attach_tags(conn, &mut rows)?;
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
    /// 创建时直接挂的标签 id 列表
    #[serde(default)]
    pub tag_ids: Option<Vec<i64>>,
}

#[tauri::command]
pub fn create_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    task: NewTask,
    origin: Option<String>,
) -> AppResult<Task> {
    let t = {
        let conn = db.0.lock().unwrap();
        create_task_conn(&conn, &task, origin_of(origin.as_deref()))?
    };
    events::broadcast(&app, events::TASKS_CHANGED);
    Ok(t)
}

/// conn 版创建（pk CLI 复用）：标题去空格、落分类、挂标签、保不变量、记日志
pub fn create_task_conn(conn: &Connection, task: &NewTask, origin: &str) -> AppResult<Task> {
    let title = task.title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::Invalid("标题不能为空".into()));
    }
    let status = if task.scheduled { "scheduled" } else { "inbox" };
    // 未指定分类时落到第一个启用分类（分类可停用，id=1 未必可用）
    let category_id = task
        .category_id
        .unwrap_or_else(|| crate::commands::categories::first_enabled_category(conn));
    conn.execute(
        "INSERT INTO tasks (title, note, category_id, status, priority, due_at, remind_at, source, external_id, created_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            title,
            task.note,
            category_id,
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
    if let Some(tag_ids) = &task.tag_ids {
        set_task_tags(conn, id, tag_ids)?;
    }
    enforce_inbox_invariant(conn, id)?;
    log_change(conn, id, "create", "title", None, Some(&title), origin)?;
    query_task(conn, id)
}

/// 全量替换某任务的标签关联
fn set_task_tags(conn: &Connection, task_id: i64, tag_ids: &[i64]) -> AppResult<()> {
    conn.execute("DELETE FROM task_tags WHERE task_id=?1", params![task_id])?;
    let mut stmt =
        conn.prepare("INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?1, ?2)")?;
    for tag_id in tag_ids {
        stmt.execute(params![task_id, tag_id])?;
    }
    Ok(())
}

fn query_task(conn: &Connection, id: i64) -> AppResult<Task> {
    let mut t = conn
        .query_row(
            &format!("SELECT {TASK_COLS} FROM tasks WHERE id=?1"),
            params![id],
            row_to_task,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("任务 {id} 不存在")),
            other => AppError::Db(other),
        })?;
    attach_tags(conn, std::slice::from_mut(&mut t))?;
    Ok(t)
}

/// conn 版取单个任务（pk CLI 复用）
pub fn get_task_conn(conn: &Connection, id: i64) -> AppResult<Task> {
    query_task(conn, id)
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
    /// 出现即全量替换标签关联（空数组 = 清空标签），缺失 = 不改
    #[serde(default)]
    pub tag_ids: Option<Vec<i64>>,
}

/// due/remind 三态：不改（缺失）/ 清空（null）/ 设置（字符串）
#[tauri::command]
pub fn update_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    patch: TaskPatch,
    origin: Option<String>,
) -> AppResult<Task> {
    let t = {
        let conn = db.0.lock().unwrap();
        update_task_conn(&conn, &patch, origin_of(origin.as_deref()))?
    };
    events::broadcast(&app, events::TASKS_CHANGED);
    Ok(t)
}

/// conn 版更新（pk CLI 复用）：字段级 patch + 不变量 + diff 日志
pub fn update_task_conn(conn: &Connection, patch: &TaskPatch, origin: &str) -> AppResult<Task> {
    let before = query_task(conn, patch.id)?;
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
        push(&mut sets, &mut p, "priority", Box::new(v.clone()));
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
    match patch.status.as_deref() {
        Some("done") => {
            push(&mut sets, &mut p, "completed_at", Box::new(now()));
        }
        Some("cancelled") => {
            push(&mut sets, &mut p, "cancelled_at", Box::new(now()));
        }
        _ => {}
    }
    if let Some(v) = &patch.status {
        push(&mut sets, &mut p, "status", Box::new(v.clone()));
    }
    p.push(Box::new(patch.id));
    if !sets.is_empty() {
        let sql = format!("UPDATE tasks SET {} WHERE id=?{}", sets.join(", "), p.len());
        conn.execute(
            &sql,
            rusqlite::params_from_iter(p.iter().map(|b| b.as_ref())),
        )?;
    }
    if let Some(tag_ids) = &patch.tag_ids {
        set_task_tags(conn, patch.id, tag_ids)?;
    }
    enforce_inbox_invariant(conn, patch.id)?;
    let t = query_task(conn, patch.id)?;
    log_task_diff(conn, &before, &t, origin)?;
    Ok(t)
}

#[tauri::command]
pub fn delete_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
    origin: Option<String>,
) -> AppResult<()> {
    {
        let conn = db.0.lock().unwrap();
        delete_task_conn(&conn, id, origin_of(origin.as_deref()))?;
    }
    events::broadcast(&app, events::TASKS_CHANGED);
    Ok(())
}

/// conn 版删除（pk CLI 复用）：task_logs 保留 tombstone，关联数据一并清理
pub fn delete_task_conn(conn: &Connection, id: i64, origin: &str) -> AppResult<()> {
    // tombstone：任务删除后 task_logs 保留（无外键约束），记录删除时的标题
    let title: Option<String> = conn
        .query_row("SELECT title FROM tasks WHERE id=?1", params![id], |r| {
            r.get(0)
        })
        .ok();
    log_change(conn, id, "delete", "title", title.as_deref(), None, origin)?;
    conn.execute("DELETE FROM tasks WHERE id=?1", params![id])?;
    conn.execute("DELETE FROM task_tags WHERE task_id=?1", params![id])?;
    conn.execute("DELETE FROM task_notes WHERE task_id=?1", params![id])?;
    Ok(())
}

// ---- 跟进记录 ----

const NOTE_COLS: &str = "id, task_id, content, source, created_at";

fn row_to_note(row: &rusqlite::Row) -> rusqlite::Result<TaskNote> {
    Ok(TaskNote {
        id: row.get(0)?,
        task_id: row.get(1)?,
        content: row.get(2)?,
        source: row.get(3)?,
        created_at: row.get(4)?,
    })
}

#[tauri::command]
pub fn list_task_notes(db: State<Db>, task_id: i64) -> AppResult<Vec<TaskNote>> {
    let conn = db.0.lock().unwrap();
    list_task_notes_conn(&conn, task_id)
}

/// conn 版跟进记录列表（pk CLI 复用）
pub fn list_task_notes_conn(conn: &Connection, task_id: i64) -> AppResult<Vec<TaskNote>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {NOTE_COLS} FROM task_notes WHERE task_id=?1 ORDER BY id"
    ))?;
    let rows = stmt
        .query_map(params![task_id], row_to_note)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// 手动添加跟进记录；AI 侧的跟进记录由 feishu 链路以 source='ai' 直接入库
#[tauri::command]
pub fn add_task_note<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    task_id: i64,
    content: String,
) -> AppResult<TaskNote> {
    let note = {
        let conn = db.0.lock().unwrap();
        add_task_note_conn(&conn, task_id, &content, "manual")?
    };
    events::broadcast(&app, events::TASKS_CHANGED);
    Ok(note)
}

/// conn 版添加跟进记录（pk CLI 复用；source: manual / ai）
pub fn add_task_note_conn(
    conn: &Connection,
    task_id: i64,
    content: &str,
    source: &str,
) -> AppResult<TaskNote> {
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err(AppError::Invalid("跟进内容不能为空".into()));
    }
    let source = match source {
        "ai" => "ai",
        _ => "manual",
    };
    conn.query_row(
        &format!("SELECT {TASK_COLS} FROM tasks WHERE id=?1"),
        params![task_id],
        row_to_task,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("任务 {task_id} 不存在"))
        }
        other => AppError::Db(other),
    })?;
    conn.execute(
        "INSERT INTO task_notes (task_id, content, source, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![task_id, content, source, now()],
    )?;
    let note = conn.query_row(
        &format!("SELECT {NOTE_COLS} FROM task_notes WHERE id=?1"),
        params![conn.last_insert_rowid()],
        row_to_note,
    )?;
    Ok(note)
}

#[tauri::command]
pub fn delete_task_note<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
) -> AppResult<()> {
    db.0.lock()
        .unwrap()
        .execute("DELETE FROM task_notes WHERE id=?1", params![id])?;
    events::broadcast(&app, events::TASKS_CHANGED);
    Ok(())
}

// ---- 操作日志查询 ----

const LOG_COLS: &str = "id, task_id, action, field, old_value, new_value, origin, created_at";

fn row_to_log(row: &rusqlite::Row) -> rusqlite::Result<TaskLog> {
    Ok(TaskLog {
        id: row.get(0)?,
        task_id: row.get(1)?,
        action: row.get(2)?,
        field: row.get(3)?,
        old_value: row.get(4)?,
        new_value: row.get(5)?,
        origin: row.get(6)?,
        created_at: row.get(7)?,
    })
}

/// 单任务操作历史（最新在前，前端编辑弹窗展示）
#[tauri::command]
pub fn list_task_logs(db: State<Db>, task_id: i64) -> AppResult<Vec<TaskLog>> {
    let conn = db.0.lock().unwrap();
    list_task_logs_conn(&conn, task_id)
}

/// conn 版操作日志（pk CLI 复用）
pub fn list_task_logs_conn(conn: &Connection, task_id: i64) -> AppResult<Vec<TaskLog>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {LOG_COLS} FROM task_logs WHERE task_id=?1 ORDER BY id DESC LIMIT 200"
    ))?;
    let rows = stmt
        .query_map(params![task_id], row_to_log)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

// ---- 专注模式：全局唯一 active 任务 ----

/// 开始一个任务：其它 active/paused 全部转回 scheduled，本任务置为 active（并记首次开始时间）
#[tauri::command]
pub fn start_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
    origin: Option<String>,
) -> AppResult<Task> {
    let t = {
        let mut conn = db.0.lock().unwrap();
        start_task_conn(&mut conn, id, origin_of(origin.as_deref()))?
    };
    events::broadcast(&app, events::TASKS_CHANGED);
    Ok(t)
}

/// conn 版开始任务（pk CLI 复用）
pub fn start_task_conn(conn: &mut Connection, id: i64, origin: &str) -> AppResult<Task> {
    // 被顶下的任务也要记状态变更日志，先取快照
    let demoted: Vec<(i64, String)> = {
        let mut stmt =
            conn.prepare("SELECT id, status FROM tasks WHERE status IN ('active','paused')")?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE tasks SET status='scheduled' WHERE status IN ('active','paused')",
        [],
    )?;
    let n = tx.execute(
        "UPDATE tasks SET status='active', started_at=COALESCE(started_at, ?2) WHERE id=?1",
        params![id, now()],
    )?;
    tx.commit()?;
    if n == 0 {
        return Err(AppError::NotFound(format!("任务 {id} 不存在")));
    }
    for (did, dstatus) in &demoted {
        log_change(
            conn,
            *did,
            "demote",
            "status",
            Some(dstatus),
            Some("scheduled"),
            origin,
        )?;
    }
    log_change(conn, id, "start", "status", None, Some("active"), origin)?;
    query_task(conn, id)
}

#[tauri::command]
pub fn pause_current_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    origin: Option<String>,
) -> AppResult<Option<Task>> {
    let t = {
        let conn = db.0.lock().unwrap();
        pause_current_task_conn(&conn, origin_of(origin.as_deref()))?
    };
    events::broadcast(&app, events::TASKS_CHANGED);
    Ok(t)
}

/// conn 版暂停（pk CLI 复用）：当前 active 转为 paused 并记日志
pub fn pause_current_task_conn(conn: &Connection, origin: &str) -> AppResult<Option<Task>> {
    let paused_id: Option<i64> = conn
        .query_row("SELECT id FROM tasks WHERE status='active'", [], |r| {
            r.get(0)
        })
        .ok();
    conn.execute("UPDATE tasks SET status='paused' WHERE status='active'", [])?;
    if let Some(pid) = paused_id {
        log_change(
            conn,
            pid,
            "pause",
            "status",
            Some("active"),
            Some("paused"),
            origin,
        )?;
    }
    Ok(conn.query_row(
        &format!("SELECT {TASK_COLS} FROM tasks WHERE status='paused' ORDER BY focus_seconds DESC LIMIT 1"),
        [],
        row_to_task,
    )
    .ok())
}

#[tauri::command]
pub fn get_current_task(db: State<Db>) -> AppResult<Option<Task>> {
    let conn = db.0.lock().unwrap();
    get_current_task_conn(&conn)
}

/// conn 版当前进行中任务（pk CLI 复用）
pub fn get_current_task_conn(conn: &Connection) -> AppResult<Option<Task>> {
    Ok(conn
        .query_row(
            &format!("SELECT {TASK_COLS} FROM tasks WHERE status='active' LIMIT 1"),
            [],
            row_to_task,
        )
        .ok())
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
            tag_ids: None,
        }
    }

    fn create(app: &tauri::App<tauri::test::MockRuntime>, title: &str, scheduled: bool) -> Task {
        let db = app.state::<Db>();
        create_task(app.handle().clone(), db, new_task(title, scheduled), None)
            .expect("create_task")
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
            start_task(handle.clone(), db, t.id, None).expect("start");
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
        let t = {
            let db = app.state::<Db>();
            create_task(
                app.handle().clone(),
                db,
                NewTask {
                    due_at: Some("2026-09-13T09:00".into()),
                    ..new_task("开会", true)
                },
                None,
            )
            .unwrap()
        };
        assert_eq!(t.status, "scheduled", "有截止时间才能进路线");
        // scheduled 标志但没给时间：不变量兜底归入草丛
        let no_due = create(&app, "没时间", true);
        assert_eq!(no_due.status, "inbox");
    }

    #[test]
    fn create_task_empty_title_rejected() {
        let app = setup();
        let db = app.state::<Db>();
        let err = create_task(
            app.handle().clone(),
            db.clone(),
            new_task("  ", false),
            None,
        )
        .unwrap_err();
        assert_eq!(err.to_string(), "输入无效: 标题不能为空");
    }

    #[test]
    fn list_tasks_open_orders_active_first() {
        let app = setup();
        let a = create(&app, "A", true);
        let b = create(&app, "B", true);
        {
            let db = app.state::<Db>();
            start_task(app.handle().clone(), db, b.id, None).expect("start");
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
                    tag_ids: None,
                },
                None,
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
            start_task(app.handle().clone(), db, active.id, None).expect("start");
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
        let t = {
            let db = app.state::<Db>();
            create_task(
                app.handle().clone(),
                db,
                NewTask {
                    due_at: Some("2026-09-13T09:00".into()),
                    ..new_task("原标题", true)
                },
                None,
            )
            .unwrap()
        };
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
                    tag_ids: None,
                },
                None,
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
                    tag_ids: None,
                },
                None,
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
        let err = update_task(app.handle().clone(), db, patch, None).unwrap_err();
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
            start_task(app.handle().clone(), db, a.id, None).expect("start a");
        }
        let current = {
            let db = app.state::<Db>();
            start_task(app.handle().clone(), db, b.id, None).expect("start b")
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
            start_task(app.handle().clone(), db, t.id, None).expect("start");
        }
        let paused = {
            let db = app.state::<Db>();
            pause_current_task(app.handle().clone(), db, None).expect("pause")
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
            delete_task(app.handle().clone(), db, t.id, None).unwrap();
        }
        let err = {
            let db = app.state::<Db>();
            get_task(db, t.id)
        };
        assert!(err.is_err());
    }

    // ---- 标签 / 跟进记录 / 搜索 ----

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
    fn create_and_update_task_with_tags() {
        let app = setup();
        let tag_a = seed_tag(&app, "重要");
        let tag_b = seed_tag(&app, "需汇报");
        let t = {
            let db = app.state::<Db>();
            create_task(
                app.handle().clone(),
                db,
                NewTask {
                    tag_ids: Some(vec![tag_a, tag_b]),
                    ..new_task("带标签", false)
                },
                None,
            )
            .unwrap()
        };
        assert_eq!(t.tags, vec!["重要".to_string(), "需汇报".to_string()]);
        // patch 全量替换为单个标签
        let updated = {
            let db = app.state::<Db>();
            let patch: TaskPatch =
                serde_json::from_value(serde_json::json!({ "id": t.id, "tagIds": [tag_b] }))
                    .unwrap();
            update_task(app.handle().clone(), db, patch, None).unwrap()
        };
        assert_eq!(updated.tags, vec!["需汇报".to_string()]);
        // 空数组清空
        let cleared = {
            let db = app.state::<Db>();
            let patch: TaskPatch =
                serde_json::from_value(serde_json::json!({ "id": t.id, "tagIds": [] })).unwrap();
            update_task(app.handle().clone(), db, patch, None).unwrap()
        };
        assert!(cleared.tags.is_empty());
    }

    #[test]
    fn task_notes_add_list_delete() {
        let app = setup();
        let t = create(&app, "有跟进", false);
        {
            let db = app.state::<Db>();
            let err = add_task_note(app.handle().clone(), db, t.id, "  ".into()).unwrap_err();
            assert!(matches!(err, AppError::Invalid(_)));
        }
        {
            let db = app.state::<Db>();
            add_task_note(app.handle().clone(), db, t.id, "对方确认周五交付".into()).unwrap();
        }
        // AI 来源的记录直插库，验证 list 一并返回
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO task_notes (task_id, content, source, created_at) VALUES (?1, 'AI 判定为跟进', 'ai', '2026-09-02T00:00:00Z')",
                params![t.id],
            )
            .unwrap();
        }
        let notes = {
            let db = app.state::<Db>();
            list_task_notes(db, t.id).unwrap()
        };
        assert_eq!(notes.len(), 2);
        assert_eq!(notes[0].source, "manual");
        assert_eq!(notes[1].source, "ai");
        {
            let db = app.state::<Db>();
            delete_task_note(app.handle().clone(), db, notes[0].id).unwrap();
        }
        let left = {
            let db = app.state::<Db>();
            list_task_notes(db, t.id).unwrap()
        };
        assert_eq!(left.len(), 1);
        // 不存在的任务不能加跟进
        let err = {
            let db = app.state::<Db>();
            add_task_note(app.handle().clone(), db, 999, "x".into()).unwrap_err()
        };
        assert!(matches!(err, AppError::NotFound(_)));
    }

    #[test]
    fn search_tasks_matches_title_note_tag_and_followups() {
        let app = setup();
        let tag_id = seed_tag(&app, "需汇报");
        let t1 = create(&app, "写季度报告", false);
        let t2 = create(&app, "修登录bug", false);
        {
            let db = app.state::<Db>();
            let patch: TaskPatch = serde_json::from_value(
                serde_json::json!({ "id": t2.id, "note": "季度报告需要附上数据", "tagIds": [tag_id] }),
            )
            .unwrap();
            update_task(app.handle().clone(), db, patch, None).unwrap();
        }
        let t3 = create(&app, "无关任务", false);
        {
            let db = app.state::<Db>();
            add_task_note(app.handle().clone(), db, t3.id, "老板催季度报告进度".into()).unwrap();
        }
        let hit_title = {
            let db = app.state::<Db>();
            search_tasks(db, "季度报告".into()).unwrap()
        };
        let ids: Vec<i64> = hit_title.iter().map(|t| t.id).collect();
        assert_eq!(
            ids,
            vec![t3.id, t2.id, t1.id],
            "标题/备注/跟进全文均命中，倒序"
        );
        let hit_tag = {
            let db = app.state::<Db>();
            search_tasks(db, "需汇报".into()).unwrap()
        };
        assert_eq!(hit_tag.len(), 1);
        assert_eq!(hit_tag[0].id, t2.id);
        assert_eq!(hit_tag[0].tags, vec!["需汇报".to_string()]);
        // 空关键词返回空，不做全表扫描
        let empty = {
            let db = app.state::<Db>();
            search_tasks(db, "  ".into()).unwrap()
        };
        assert!(empty.is_empty());
        // LIKE 通配符按字面匹配
        let none = {
            let db = app.state::<Db>();
            search_tasks(db, "%".into()).unwrap()
        };
        assert!(none.is_empty());
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
            update_task(app.handle().clone(), db, patch, None).expect("update");
        }
        let got = {
            let db = app.state::<Db>();
            get_task(db, t).expect("get")
        };
        assert_eq!(got.due_at, None, "dueAt: null 应清空截止时间");
        assert_eq!(
            got.status, "inbox",
            "清空截止时间且从未开始：不变量归入草丛"
        );
    }

    // ---- 状态机 v4：取消 / started_at / 操作日志 ----

    fn patch_json(app: &tauri::App<tauri::test::MockRuntime>, v: serde_json::Value) -> Task {
        let db = app.state::<Db>();
        let patch: TaskPatch = serde_json::from_value(v).unwrap();
        update_task(app.handle().clone(), db, patch, Some("main".into())).expect("update")
    }

    #[test]
    fn cancel_sets_cancelled_at_and_shows_in_dex_list() {
        let app = setup();
        let t = {
            let db = app.state::<Db>();
            create_task(
                app.handle().clone(),
                db,
                NewTask {
                    due_at: Some("2026-09-13T09:00".into()),
                    ..new_task("不做了", true)
                },
                None,
            )
            .unwrap()
        };
        let cancelled = patch_json(
            &app,
            serde_json::json!({ "id": t.id, "status": "cancelled" }),
        );
        assert_eq!(cancelled.status, "cancelled");
        assert!(cancelled.cancelled_at.is_some(), "取消时写入 cancelled_at");

        let open = list(&app, "open");
        assert!(open.iter().all(|x| x.id != t.id), "取消后不在 open 列表");
        let dex = list(&app, "done");
        assert_eq!(dex.len(), 1, "图鉴列表包含已取消任务");

        // 恢复：回到路线（有截止时间）
        let restored = patch_json(
            &app,
            serde_json::json!({ "id": t.id, "status": "scheduled" }),
        );
        assert_eq!(restored.status, "scheduled");
        assert_eq!(list(&app, "open").len(), 1);
    }

    #[test]
    fn started_task_without_due_stays_scheduled_after_demote() {
        let app = setup();
        let a = create(&app, "开始过", false); // 无截止时间，草丛
        {
            let db = app.state::<Db>();
            start_task(app.handle().clone(), db, a.id, None).expect("start");
        }
        let got = {
            let db = app.state::<Db>();
            get_task(db, a.id).unwrap()
        };
        assert!(got.started_at.is_some(), "出发时记录首次开始时间");

        // 被新目标顶下：开始过的任务回 scheduled，不被不变量打回 inbox
        let b = create(&app, "新目标", false);
        {
            let db = app.state::<Db>();
            start_task(app.handle().clone(), db, b.id, None).expect("start b");
        }
        let a_row = list(&app, "open")
            .into_iter()
            .find(|x| x.id == a.id)
            .unwrap();
        assert_eq!(a_row.status, "scheduled", "开始过的任务可停留在路线");
    }

    #[test]
    fn task_logs_record_create_update_and_delete() {
        let app = setup();
        let t = {
            let db = app.state::<Db>();
            create_task(
                app.handle().clone(),
                db,
                new_task("日志", false),
                Some("main".into()),
            )
            .unwrap()
        };
        patch_json(
            &app,
            serde_json::json!({ "id": t.id, "title": "日志改名", "priority": "high" }),
        );
        {
            let db = app.state::<Db>();
            delete_task(app.handle().clone(), db, t.id, Some("pet".into())).unwrap();
        }

        let logs = {
            let db = app.state::<Db>();
            list_task_logs(db, t.id).unwrap()
        };
        // 最新在前：delete → update(priority) → update(title) → create
        assert_eq!(logs.len(), 4, "共 4 条: {logs:?}");
        assert_eq!(logs[0].action, "delete");
        assert_eq!(logs[0].origin, "pet", "来源窗口写入日志");
        assert_eq!(
            logs[0].old_value.as_deref(),
            Some("日志改名"),
            "tombstone 保留标题"
        );
        assert_eq!(logs[1].field, "priority");
        assert_eq!(logs[2].field, "title");
        assert_eq!(logs[2].new_value.as_deref(), Some("日志改名"));
        assert_eq!(logs[3].action, "create");
        assert_eq!(logs[3].origin, "main", "create 记录命令来源");
    }

    #[test]
    fn update_without_changes_writes_no_log() {
        let app = setup();
        let t = create(&app, "无变化", false);
        patch_json(&app, serde_json::json!({ "id": t.id, "title": "无变化" }));
        let logs = {
            let db = app.state::<Db>();
            list_task_logs(db, t.id).unwrap()
        };
        assert_eq!(logs.len(), 1, "只应有 create 一条: {logs:?}");
    }

    #[test]
    fn start_and_pause_logged_with_status_diff() {
        let app = setup();
        let a = create(&app, "A", false);
        let b = create(&app, "B", false);
        {
            let db = app.state::<Db>();
            start_task(app.handle().clone(), db.clone(), a.id, None).expect("start a");
            start_task(app.handle().clone(), db.clone(), b.id, None).expect("start b");
            pause_current_task(app.handle().clone(), db, None).expect("pause");
        }
        let a_logs = {
            let db = app.state::<Db>();
            list_task_logs(db, a.id).unwrap()
        };
        // A：start → 被 B 顶下记 demote
        assert!(a_logs
            .iter()
            .any(|l| l.action == "start" && l.new_value.as_deref() == Some("active")));
        assert!(
            a_logs
                .iter()
                .any(|l| l.action == "demote" && l.new_value.as_deref() == Some("scheduled")),
            "被顶下也记状态变更: {a_logs:?}"
        );
        let b_logs = {
            let db = app.state::<Db>();
            list_task_logs(db, b.id).unwrap()
        };
        assert!(b_logs.iter().any(|l| l.action == "pause"));
    }
}
