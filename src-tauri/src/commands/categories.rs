use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::events;
use crate::models::Category;
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn list_categories(db: State<Db>) -> AppResult<Vec<Category>> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare("SELECT id, name, pokemon, sprite FROM categories ORDER BY id")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Category {
                id: r.get(0)?,
                name: r.get(1)?,
                pokemon: r.get(2)?,
                sprite: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn set_category_pokemon<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
    pokemon: String,
    sprite: String,
) -> AppResult<()> {
    db.0.lock().unwrap().execute(
        "UPDATE categories SET pokemon=?2, sprite=?3 WHERE id=?1",
        params![id, pokemon, sprite],
    )?;
    events::broadcast(&app, events::CATEGORIES_CHANGED);
    Ok(())
}

#[tauri::command]
pub fn create_category<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    name: String,
    pokemon: String,
    sprite: String,
) -> AppResult<Category> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::Invalid("分类名不能为空".into()));
    }
    let conn = db.0.lock().unwrap();
    conn.execute(
        "INSERT INTO categories (name, pokemon, sprite) VALUES (?1, ?2, ?3)",
        params![name, pokemon, sprite],
    )?;
    let id = conn.last_insert_rowid();
    drop(conn);
    events::broadcast(&app, events::CATEGORIES_CHANGED);
    Ok(Category {
        id,
        name,
        pokemon,
        sprite,
    })
}

#[tauri::command]
pub fn update_category<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
    name: String,
    pokemon: String,
    sprite: String,
) -> AppResult<()> {
    db.0.lock().unwrap().execute(
        "UPDATE categories SET name=?2, pokemon=?3, sprite=?4 WHERE id=?1",
        params![id, name, pokemon, sprite],
    )?;
    events::broadcast(&app, events::CATEGORIES_CHANGED);
    Ok(())
}

/// 删除分类：其下任务移回第一个分类；不允许删除最后一个分类
#[tauri::command]
pub fn delete_category<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
) -> AppResult<()> {
    let conn = db.0.lock().unwrap();
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM categories", [], |r| r.get(0))?;
    if count <= 1 {
        return Err(AppError::Invalid("至少保留一个分类".into()));
    }
    let fallback: i64 = conn.query_row(
        "SELECT id FROM categories WHERE id != ?1 ORDER BY id LIMIT 1",
        params![id],
        |r| r.get(0),
    )?;
    conn.execute(
        "UPDATE tasks SET category_id=?2 WHERE category_id=?1",
        params![id, fallback],
    )?;
    conn.execute("DELETE FROM categories WHERE id=?1", params![id])?;
    drop(conn);
    events::broadcast(&app, events::CATEGORIES_CHANGED);
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

    #[test]
    fn category_crud_and_reassignment() {
        let app = setup();
        let cat = {
            let db = app.state::<Db>();
            create_category(
                app.handle().clone(),
                db,
                "新分类".into(),
                "伊布".into(),
                "eevee".into(),
            )
            .unwrap()
        };
        assert!(cat.id > 6);
        {
            let db = app.state::<Db>();
            update_category(
                app.handle().clone(),
                db.clone(),
                cat.id,
                "改名".into(),
                "卡比兽".into(),
                "snorlax".into(),
            )
            .unwrap();
            set_category_pokemon(
                app.handle().clone(),
                db,
                cat.id,
                "皮卡丘".into(),
                "pikachu".into(),
            )
            .unwrap();
        }
        // 直接改库挂一个任务到新分类（任务命令的测试在 tasks.rs）
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO tasks (title, category_id, status, created_at) VALUES ('归属新分类', ?1, 'scheduled', '2026-09-01T00:00:00Z')",
                params![cat.id],
            )
            .unwrap();
        }
        {
            let db = app.state::<Db>();
            delete_category(app.handle().clone(), db, cat.id).unwrap();
        }
        let cats = {
            let db = app.state::<Db>();
            list_categories(db).unwrap()
        };
        let task_cat: i64 = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.query_row("SELECT category_id FROM tasks LIMIT 1", [], |r| r.get(0))
                .unwrap()
        };
        assert_ne!(task_cat, cat.id, "删除分类后任务被迁移");
        assert!(!cats.iter().any(|c| c.id == cat.id));
    }

    #[test]
    fn delete_last_category_rejected() {
        let app = setup();
        {
            let db = app.state::<Db>();
            let cats = list_categories(db).unwrap();
            for c in cats {
                let db = app.state::<Db>();
                let _ = delete_category(app.handle().clone(), db, c.id);
            }
        }
        let err = {
            let db = app.state::<Db>();
            delete_category(app.handle().clone(), db, 1)
        };
        let err = err.unwrap_err();
        assert!(
            matches!(err, AppError::Invalid(_)),
            "至少保留一个分类: {err}"
        );
    }

    #[test]
    fn create_category_empty_name_rejected() {
        let app = setup();
        let db = app.state::<Db>();
        let err = create_category(
            app.handle().clone(),
            db,
            "  ".into(),
            "伊布".into(),
            "eevee".into(),
        )
        .unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)));
    }
}
