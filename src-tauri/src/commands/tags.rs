use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::models::Tag;
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn list_tags(db: State<Db>) -> AppResult<Vec<Tag>> {
    let conn = db.0.lock().unwrap();
    list_tags_conn(&conn)
}

/// conn 版标签列表（pk CLI 复用）
pub fn list_tags_conn(conn: &rusqlite::Connection) -> AppResult<Vec<Tag>> {
    let mut stmt = conn.prepare("SELECT id, name, description FROM tags ORDER BY id")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Tag {
                id: r.get(0)?,
                name: r.get(1)?,
                description: r.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn create_tag<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    name: String,
    description: Option<String>,
) -> AppResult<Tag> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Invalid("标签名不能为空".into()));
    }
    let description = description.unwrap_or_default();
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO tags (name, description, created_at) VALUES (?1, ?2, ?3)",
        params![name, description, now()],
    )?;
    let id = conn.last_insert_rowid();
    drop(conn);
    events::broadcast(&app, events::TAGS_CHANGED);
    Ok(Tag {
        id,
        name,
        description,
    })
}

#[tauri::command]
pub fn update_tag<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
    name: String,
    description: Option<String>,
) -> AppResult<()> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Invalid("标签名不能为空".into()));
    }
    let n = db.0.lock().unwrap().execute(
        "UPDATE tags SET name=?2, description=?3 WHERE id=?1",
        params![id, name, description.unwrap_or_default()],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("标签 {id} 不存在")));
    }
    events::broadcast(&app, events::TAGS_CHANGED);
    Ok(())
}

/// 删除标签：任务上的关联随外键级联清理（task_tags 手动删，无外键约束）
#[tauri::command]
pub fn delete_tag<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
) -> AppResult<()> {
    let conn = db.0.lock().unwrap();
    conn.execute("DELETE FROM task_tags WHERE tag_id=?1", params![id])?;
    conn.execute("DELETE FROM tags WHERE id=?1", params![id])?;
    drop(conn);
    events::broadcast(&app, events::TAGS_CHANGED);
    events::broadcast(&app, events::TASKS_CHANGED);
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

    fn setup() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(Db(Mutex::new(test_conn())));
        app.manage(PendingMainReopen(std::sync::atomic::AtomicBool::new(false)));
        app
    }

    fn tags(app: &tauri::App<tauri::test::MockRuntime>) -> Vec<Tag> {
        let db = app.state::<Db>();
        list_tags(db).unwrap()
    }

    #[test]
    fn tag_crud_roundtrip() {
        let app = setup();
        let tag = {
            let db = app.state::<Db>();
            create_tag(
                app.handle().clone(),
                db,
                "重要".into(),
                Some("核心目标相关".into()),
            )
            .unwrap()
        };
        assert!(tag.id > 0);
        {
            let db = app.state::<Db>();
            update_tag(
                app.handle().clone(),
                db,
                tag.id,
                "重要事项".into(),
                Some("改了".into()),
            )
            .unwrap();
        }
        let got = tags(&app);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "重要事项");
        assert_eq!(got[0].description, "改了");
        {
            let db = app.state::<Db>();
            delete_tag(app.handle().clone(), db, tag.id).unwrap();
        }
        assert!(tags(&app).is_empty());
    }

    #[test]
    fn create_tag_rejects_blank_and_duplicates() {
        let app = setup();
        let err = {
            let db = app.state::<Db>();
            create_tag(app.handle().clone(), db, "  ".into(), None).unwrap_err()
        };
        assert!(matches!(err, AppError::Invalid(_)));
        {
            let db = app.state::<Db>();
            create_tag(app.handle().clone(), db, "重要".into(), None).unwrap();
        }
        // tags.name UNIQUE：重复名归为输入错误
        let err = {
            let db = app.state::<Db>();
            create_tag(app.handle().clone(), db, "重要".into(), None).unwrap_err()
        };
        assert!(matches!(err, AppError::Db(_)), "唯一约束冲突: {err}");
    }

    #[test]
    fn update_missing_tag_is_not_found() {
        let app = setup();
        let err = {
            let db = app.state::<Db>();
            update_tag(app.handle().clone(), db, 999, "x".into(), None).unwrap_err()
        };
        assert!(matches!(err, AppError::NotFound(_)));
    }

    /// 删除标签时任务上的关联一并清理
    #[test]
    fn delete_tag_clears_task_links() {
        let app = setup();
        let tag_id = {
            let db = app.state::<Db>();
            create_tag(app.handle().clone(), db, "需汇报".into(), None)
                .unwrap()
                .id
        };
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO tasks (title, status, created_at) VALUES ('任务A', 'inbox', '2026-09-01T00:00:00Z')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO task_tags (task_id, tag_id) VALUES (1, ?1)",
                params![tag_id],
            )
            .unwrap();
        }
        {
            let db = app.state::<Db>();
            delete_tag(app.handle().clone(), db, tag_id).unwrap();
        }
        let links: i64 = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.query_row("SELECT COUNT(*) FROM task_tags", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(links, 0);
    }
}
