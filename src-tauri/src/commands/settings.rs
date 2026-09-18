use crate::db::Db;
use crate::error::AppResult;
use crate::events;
use crate::secrets;
use rusqlite::params;
use tauri::State;

/// 读设置：秘钥类键不回传明文——已保存返回 STORED_SENTINEL 占位，未保存返回 None
#[tauri::command]
pub fn get_setting(db: State<Db>, key: String) -> AppResult<Option<String>> {
    let conn = db.0.lock().unwrap();
    if secrets::is_secret_key(&key) {
        return Ok(secrets::secret_get(&conn, &key).map(|_| secrets::STORED_SENTINEL.to_string()));
    }
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
    {
        let conn = db.0.lock().unwrap();
        if secrets::is_secret_key(&key) {
            // 前端未改动时回传占位值：跳过，避免把哨兵当秘钥写入
            if value == secrets::STORED_SENTINEL {
                return Ok(());
            }
            secrets::secret_set(&conn, &key, &value)?;
            events::broadcast(&app, events::SETTINGS_CHANGED);
            return Ok(());
        }
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=?2",
            params![key, value],
        )?;
    }
    events::broadcast(&app, events::SETTINGS_CHANGED);
    Ok(())
}

/// 全量设置：秘钥类键以占位值返回（已保存）或不返回（未保存），明文不出后端
#[tauri::command]
pub fn list_all_settings(db: State<Db>) -> AppResult<std::collections::HashMap<String, String>> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
    let mut rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<std::collections::HashMap<_, _>, _>>()?;
    // 秘钥可能已全部迁入钥匙串（settings 表无行），从秘钥层补占位
    for key in secrets::SECRET_KEYS {
        if secrets::secret_get(&conn, key).is_some() {
            rows.insert((*key).to_string(), secrets::STORED_SENTINEL.to_string());
        } else {
            rows.remove(*key);
        }
    }
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

    fn setup() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(Db(Mutex::new(test_conn())));
        app.manage(PendingMainReopen(std::sync::atomic::AtomicBool::new(false)));
        app
    }

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
}
