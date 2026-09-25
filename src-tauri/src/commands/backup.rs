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
