use crate::db::Db;
use crate::error::AppResult;
use crate::events;
use rusqlite::params;
use tauri::State;

#[tauri::command]
pub fn get_setting(db: State<Db>, key: String) -> AppResult<Option<String>> {
    let conn = db.0.lock().unwrap();
    let v = conn
        .query_row(
            "SELECT value FROM settings WHERE key=?1",
            params![key],
            |r| r.get::<_, String>(0),
        )
        .ok();
    Ok(v)
}

#[tauri::command]
pub fn set_setting<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    key: String,
    value: String,
) -> AppResult<()> {
    db.0.lock().unwrap().execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2",
        params![key, value],
    )?;
    events::broadcast(&app, events::SETTINGS_CHANGED);
    Ok(())
}

#[tauri::command]
pub fn list_all_settings(db: State<Db>) -> AppResult<std::collections::HashMap<String, String>> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<std::collections::HashMap<_, _>, _>>()?;
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::windows::PendingMainReopen;
    use crate::db::tests::test_conn;
    use crate::db::Db;
    use std::sync::Mutex;
    use tauri::Manager;

    #[test]
    fn settings_get_set_list() {
        let app = tauri::test::mock_app();
        app.manage(Db(Mutex::new(test_conn())));
        app.manage(PendingMainReopen(std::sync::atomic::AtomicBool::new(false)));
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
}
