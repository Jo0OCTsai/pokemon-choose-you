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

    /// 秘钥键：写入后明文不出后端——get/list 只见占位值，原值仍可从秘钥层读回
    #[test]
    fn secret_settings_never_expose_plaintext() {
        let app = setup();
        {
            let db = app.state::<Db>();
            set_setting(
                app.handle().clone(),
                db.clone(),
                "todoist_token".into(),
                "real-secret".into(),
            )
            .unwrap();
            // 占位值回传时跳过写入（前端未改动的情形）
            set_setting(
                app.handle().clone(),
                db,
                "todoist_token".into(),
                secrets::STORED_SENTINEL.into(),
            )
            .unwrap();
        }
        {
            let db = app.state::<Db>();
            assert_eq!(
                get_setting(db, "todoist_token".into()).unwrap().as_deref(),
                Some(secrets::STORED_SENTINEL),
                "已保存的秘钥只回占位值"
            );
        }
        let all = {
            let db = app.state::<Db>();
            list_all_settings(db).unwrap()
        };
        assert_eq!(
            all.get("todoist_token").map(String::as_str),
            Some(secrets::STORED_SENTINEL)
        );
        // 原值仍在秘钥层（回落路径 = settings 表），链路读取不受影响
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            assert_eq!(
                secrets::secret_get(&conn, "todoist_token").as_deref(),
                Some("real-secret"),
                "哨兵没有覆盖真实秘钥"
            );
        }

        // 清空 = 删除
        {
            let db = app.state::<Db>();
            set_setting(
                app.handle().clone(),
                db,
                "todoist_token".into(),
                String::new(),
            )
            .unwrap();
        }
        let all = {
            let db = app.state::<Db>();
            list_all_settings(db).unwrap()
        };
        assert!(!all.contains_key("todoist_token"), "清空后不再出现");
    }
}
