use crate::backup::{self, BackupInfo};
use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::events;
use rusqlite::params;
use tauri::State;

fn data_dir() -> AppResult<std::path::PathBuf> {
    crate::db::data_dir().ok_or_else(|| AppError::External("定位应用数据目录失败".into()))
}

/// 备份列表（时间倒序）
#[tauri::command]
pub fn list_backups<R: tauri::Runtime>(_app: tauri::AppHandle<R>) -> AppResult<Vec<BackupInfo>> {
    backup::list_backups(&data_dir()?)
}

/// 立即备份（手动入口；同样参与滚动保留），返回备份文件名
#[tauri::command]
pub fn create_backup_now<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    db: State<Db>,
) -> AppResult<String> {
    let keep: usize = {
        let conn = db.0.lock().unwrap();
        conn.query_row(
            "SELECT value FROM settings WHERE key='backup_keep'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(7)
    };
    let path = {
        let conn = db.0.lock().unwrap();
        backup::create_backup(&data_dir()?, &conn)?
    };
    backup::prune_backups(&data_dir()?, keep.max(1));
    Ok(path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default())
}

/// 从备份恢复：在线灌回当前库并补迁移，然后广播全部数据变更事件让两端窗口刷新
#[tauri::command]
pub fn restore_backup<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    file: String,
) -> AppResult<()> {
    {
        let mut conn = db.0.lock().unwrap();
        backup::restore_backup(&data_dir()?, &mut conn, &file)?;
        // 恢复把 settings 也回滚了，当日备份标记一并补上，避免恢复后立刻又触发一轮
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let _ = conn.execute(
            "INSERT INTO settings (key, value) VALUES ('last_backup_date', ?1)
             ON CONFLICT(key) DO UPDATE SET value=?1",
            params![today],
        );
    }
    events::broadcast(&app, events::TASKS_CHANGED);
    events::broadcast(&app, events::CATEGORIES_CHANGED);
    events::broadcast(&app, events::TAGS_CHANGED);
    events::broadcast(&app, events::SETTINGS_CHANGED);
    events::broadcast(&app, events::CHAT_MESSAGES_CHANGED);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::windows::PendingMainReopen;
    use crate::db::tests::test_conn;
    use std::sync::Mutex;
    use tauri::Manager;

    fn setup() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(Db(Mutex::new(test_conn())));
        app.manage(PendingMainReopen(std::sync::atomic::AtomicBool::new(false)));
        app
    }

    /// 注入独立 CHOOSE_YOU_HOME（进程级，一个测试一个窗口，用完即还）
    fn inject_home(name: &str) -> std::path::PathBuf {
        let home =
            std::env::temp_dir().join(format!("pk-cmd-backup-{}-{name}", std::process::id()));
        std::fs::create_dir_all(home.join("data")).unwrap();
        std::env::set_var(crate::db::HOME_ENV, &home);
        home
    }

    /// 命令层往返（create/list 的滚动保留 + restore 灌回与当日标记），共用一个注入窗口：
    /// backup_keep=2 下建 3 份只留最新 2 份；恢复后数据回来且补写 last_backup_date
    #[test]
    fn create_list_prune_and_restore_via_command_layer() {
        let app = setup();
        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('backup_keep', '2')",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO tasks (title, status, created_at) VALUES ('恢复我', 'inbox', '2026-09-13T00:00:00Z')",
                [],
            )
            .unwrap();
        }
        let home = inject_home("roundtrip");

        let mut file = String::new();
        for _ in 0..3 {
            let db = app.state::<Db>();
            file = create_backup_now(app.handle().clone(), db).unwrap();
        }
        let list = list_backups(app.handle().clone()).unwrap();
        assert_eq!(list.len(), 2, "backup_keep=2 滚动只留最新两份");
        assert!(
            list.iter().any(|b| b.file == file),
            "最新一份保留: {file} vs {list:?}"
        );

        {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            conn.execute("DELETE FROM tasks", []).unwrap();
        }
        {
            let db = app.state::<Db>();
            restore_backup(app.handle().clone(), db, file).unwrap();
        }
        std::env::remove_var(crate::db::HOME_ENV);
        let (n, last_backup) = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let n: i64 = conn
                .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
                .unwrap();
            let lb: Option<String> = conn
                .query_row(
                    "SELECT value FROM settings WHERE key='last_backup_date'",
                    [],
                    |r| r.get(0),
                )
                .ok();
            (n, lb)
        };
        assert_eq!(n, 1, "恢复后任务回来");
        assert!(
            last_backup.is_some(),
            "恢复后补当日备份标记，避免再触发一轮"
        );
        let _ = std::fs::remove_dir_all(&home);
    }
}
