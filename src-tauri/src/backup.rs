//! 自动版本化备份：`VACUUM INTO` 生成压缩快照（不含 WAL，可直接打开），
//! 每日一份滚动保留；恢复走 SQLite 在线 backup API 反向灌回，不用重启应用。
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// 备份文件名前缀 / 后缀（滚动清理与恢复的合法性判断共用）
const NAME_PREFIX: &str = "pokemon-knock-";
const NAME_SUFFIX: &str = ".db";

pub fn backup_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("backups")
}

fn is_backup_name(name: &str) -> bool {
    name.starts_with(NAME_PREFIX) && name.ends_with(NAME_SUFFIX)
}

/// 创建一份快照，返回文件路径。同一秒内重复创建时追加序号避免覆盖
pub fn create_backup(data_dir: &Path, conn: &Connection) -> AppResult<PathBuf> {
    let dir = backup_dir(data_dir);
    std::fs::create_dir_all(&dir)?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let mut path = dir.join(format!("{NAME_PREFIX}{stamp}{NAME_SUFFIX}"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{NAME_PREFIX}{stamp}-{n}{NAME_SUFFIX}"));
        n += 1;
    }
    conn.execute("VACUUM INTO ?1", params![path.to_string_lossy()])?;
    log::info!("backup: 已创建快照 {}", path.display());
    Ok(path)
}

/// 备份列表（按时间倒序，文件名即时间戳）
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file: String,
    pub size: u64,
    /// 备份时间（RFC3339，取文件修改时间）
    pub created_at: String,
}

pub fn list_backups(data_dir: &Path) -> AppResult<Vec<BackupInfo>> {
    let dir = backup_dir(data_dir);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in std::fs::read_dir(&dir)? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_backup_name(&name) {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let created_at = meta
            .modified()
            .ok()
            .map(|t| {
                let dt: chrono::DateTime<chrono::Local> = t.into();
                dt.to_rfc3339()
            })
            .unwrap_or_default();
        out.push(BackupInfo {
            file: name,
            size: meta.len(),
            created_at,
        });
    }
    // 文件名含时间戳，字典序倒序即时间倒序
    out.sort_by(|a, b| b.file.cmp(&a.file));
    Ok(out)
}

/// 滚动清理：只保留最新 keep 份，返回删除数
pub fn prune_backups(data_dir: &Path, keep: usize) -> usize {
    let Ok(list) = list_backups(data_dir) else {
        return 0;
    };
    let mut removed = 0;
    for old in list.iter().skip(keep) {
        let path = backup_dir(data_dir).join(&old.file);
        match std::fs::remove_file(&path) {
            Ok(()) => {
                removed += 1;
                log::info!("backup: 滚动清理 {}", old.file);
            }
            Err(e) => log::warn!("backup: 清理 {} 失败: {e}", old.file),
        }
    }
    removed
}

/// 从备份恢复：SQLite 在线 backup API 把备份文件灌回当前连接，随后补跑迁移。
/// file 只认备份目录里的文件名（拒绝路径穿越），由 list_backups 提供
pub fn restore_backup(data_dir: &Path, conn: &mut Connection, file: &str) -> AppResult<()> {
    if !is_backup_name(file) || file.contains('/') || file.contains('\\') {
        return Err(AppError::Invalid(format!("非法备份文件名：{file}")));
    }
    let path = backup_dir(data_dir).join(file);
    if !path.exists() {
        return Err(AppError::NotFound(format!("备份 {file} 不存在")));
    }
    let src = Connection::open(&path)?;
    use rusqlite::backup::Backup;
    let bak = Backup::new(&src, conn)?;
    bak.run_to_completion(100, Duration::from_millis(5), None)?;
    drop(bak);
    drop(src);
    // 备份可能来自旧版本：补跑迁移 + 默认分类补种
    crate::db::init_conn(conn).map_err(|e| AppError::External(e.to_string()))?;
    log::info!("backup: 已从 {file} 恢复");
    Ok(())
}

/// 每日调度的一次决策（独立出来便于测试）：
/// 开关开着、今天还没备份过、库里有数据（空库不备份）→ 备份 + 滚动清理 + 记日期。
/// 返回是否创建了备份。
pub fn run_daily_backup(
    data_dir: &Path,
    conn: &Connection,
    enabled: bool,
    keep: usize,
    today: &str,
) -> bool {
    if !enabled {
        return false;
    }
    let last: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key='last_backup_date'",
            [],
            |r| r.get(0),
        )
        .ok();
    if last.as_deref() == Some(today) {
        return false;
    }
    // 空库不备份（全新安装还没积累数据）
    let has_data: bool = conn
        .query_row(
            "SELECT (SELECT COUNT(*) FROM tasks) + (SELECT COUNT(*) FROM chat_messages) > 0",
            [],
            |r| r.get::<_, i64>(0),
        )
        .map(|v| v != 0)
        .unwrap_or(true);
    if !has_data {
        return false;
    }
    match create_backup(data_dir, conn) {
        Ok(_) => {
            prune_backups(data_dir, keep.max(1));
            let _ = conn.execute(
                "INSERT INTO settings (key, value) VALUES ('last_backup_date', ?1)
                 ON CONFLICT(key) DO UPDATE SET value=?1",
                params![today],
            );
            true
        }
        Err(e) => {
            log::warn!("backup: 每日备份失败（下轮重试）: {e}");
            false
        }
    }
}

/// 每日备份循环：每 30 分钟醒一次，跨天且开关开启时补一份快照
pub fn spawn_daily_loop<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(30 * 60));
        loop {
            tick.tick().await;
            let result: AppResult<()> = (|| {
                use tauri::Manager;
                let db = app.state::<crate::db::Db>();
                let data_dir = app.path().app_data_dir()?;
                let conn = db.0.lock().unwrap();
                let get = |k: &str| -> Option<String> {
                    conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
                        r.get::<_, String>(0)
                    })
                    .ok()
                };
                let enabled = get("backup_enabled").as_deref() != Some("false");
                let keep: usize = get("backup_keep").and_then(|v| v.parse().ok()).unwrap_or(7);
                let today = chrono::Local::now().format("%Y-%m-%d").to_string();
                run_daily_backup(&data_dir, &conn, enabled, keep, &today);
                Ok(())
            })();
            if let Err(e) = result {
                log::warn!("backup: 调度异常: {e}");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::test_conn;

    fn tmp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pk-backup-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// VACUUM INTO 产出的是可独立打开的完整库，且不含 WAL 垃圾
    #[test]
    fn create_backup_writes_standalone_db() {
        let dir = tmp_dir("create");
        let conn = test_conn();
        conn.execute(
            "INSERT INTO tasks (title, status, created_at) VALUES ('备份我', 'inbox', '2026-09-13T00:00:00Z')",
            [],
        )
        .unwrap();
        let path = create_backup(&dir, &conn).unwrap();
        let snapshot = Connection::open(&path).unwrap();
        let n: i64 = snapshot
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "快照包含全部数据");
        // 源库继续写不影响快照
        conn.execute(
            "INSERT INTO tasks (title, status, created_at) VALUES ('后来的', 'inbox', '2026-09-13T01:00:00Z')",
            [],
        )
        .unwrap();
        let n2: i64 = snapshot
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n2, 1);
    }

    /// 同一秒内两次备份不互相覆盖
    #[test]
    fn same_second_backups_do_not_collide() {
        let dir = tmp_dir("collide");
        let conn = test_conn();
        let a = create_backup(&dir, &conn).unwrap();
        let b = create_backup(&dir, &conn).unwrap();
        assert_ne!(a, b);
        assert!(a.exists() && b.exists());
    }

    /// 列表按时间倒序；滚动清理只留最新 keep 份
    #[test]
    fn list_desc_and_prune_keeps_newest() {
        let dir = tmp_dir("prune");
        let sub = backup_dir(&dir);
        std::fs::create_dir_all(&sub).unwrap();
        for name in [
            "pokemon-knock-20260910-080000.db",
            "pokemon-knock-20260911-080000.db",
            "pokemon-knock-20260912-080000.db",
            "pokemon-knock-20260913-080000.db",
        ] {
            std::fs::File::create(sub.join(name)).unwrap();
        }
        // 非备份名不参与
        std::fs::File::create(sub.join("notes.txt")).unwrap();

        let list = list_backups(&dir).unwrap();
        assert_eq!(
            list.iter().map(|b| b.file.as_str()).collect::<Vec<_>>(),
            vec![
                "pokemon-knock-20260913-080000.db",
                "pokemon-knock-20260912-080000.db",
                "pokemon-knock-20260911-080000.db",
                "pokemon-knock-20260910-080000.db",
            ],
            "倒序排列"
        );

        let removed = prune_backups(&dir, 2);
        assert_eq!(removed, 2);
        let left = list_backups(&dir).unwrap();
        assert_eq!(left.len(), 2);
        assert_eq!(left[0].file, "pokemon-knock-20260913-080000.db");
        assert_eq!(left[1].file, "pokemon-knock-20260912-080000.db");
        assert!(sub.join("notes.txt").exists(), "无关文件不动");
    }

    /// 恢复：备份→改动→恢复，数据回到备份点；旧版本备份恢复后自动补迁移
    #[test]
    fn restore_rolls_db_back_to_snapshot() {
        let dir = tmp_dir("restore");
        let mut conn = test_conn();
        conn.execute(
            "INSERT INTO tasks (title, status, created_at) VALUES ('备份时的任务', 'inbox', '2026-09-13T00:00:00Z')",
            [],
        )
        .unwrap();
        let path = create_backup(&dir, &conn).unwrap();
        let file = path.file_name().unwrap().to_string_lossy().into_owned();

        conn.execute(
            "INSERT INTO tasks (title, status, created_at) VALUES ('备份后的新任务', 'inbox', '2026-09-13T02:00:00Z')",
            [],
        )
        .unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 2);

        restore_backup(&dir, &mut conn, &file).unwrap();
        let titles: Vec<String> = {
            let mut stmt = conn.prepare("SELECT title FROM tasks ORDER BY id").unwrap();
            stmt.query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(titles, vec!["备份时的任务".to_string()], "恢复到备份点");
    }

    /// 恢复只认备份目录里的备份文件名，拒绝路径穿越与任意文件
    #[test]
    fn restore_rejects_path_traversal_and_foreign_names() {
        let dir = tmp_dir("security");
        let mut conn = test_conn();
        let evil = "../pokemon-knock.db";
        let err = restore_backup(&dir, &mut conn, evil).unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)), "{err}");
        let err = restore_backup(&dir, &mut conn, "secrets.txt").unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)), "{err}");
        let err = restore_backup(&dir, &mut conn, "pokemon-knock-20990101-000000.db").unwrap_err();
        assert!(
            matches!(err, AppError::NotFound(_)),
            "不存在的备份报 NotFound"
        );
    }

    /// 每日调度：关着不动、当天已备份不动、空库不动、跨天第一轮备份成功并记日期
    #[test]
    fn daily_backup_decisions() {
        let dir = tmp_dir("daily");
        {
            let conn = test_conn();
            assert!(
                !run_daily_backup(&dir, &conn, false, 7, "2026-09-13"),
                "开关关闭"
            );
            assert!(
                !run_daily_backup(&dir, &conn, true, 7, "2026-09-13"),
                "空库不备份"
            );
            conn.execute(
                "INSERT INTO tasks (title, status, created_at) VALUES ('任务', 'inbox', '2026-09-01T00:00:00Z')",
                [],
            )
            .unwrap();
            assert!(
                run_daily_backup(&dir, &conn, true, 7, "2026-09-13"),
                "跨天第一轮备份"
            );
            assert!(
                !run_daily_backup(&dir, &conn, true, 7, "2026-09-13"),
                "当天已备份"
            );
            assert!(
                run_daily_backup(&dir, &conn, true, 7, "2026-09-14"),
                "次日再备"
            );
        }
        // 滚动保留生效（keep=1）
        let conn = test_conn();
        conn.execute(
            "INSERT INTO tasks (title, status, created_at) VALUES ('任务', 'inbox', '2026-09-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('last_backup_date', '2026-09-12')",
            [],
        )
        .unwrap();
        run_daily_backup(&dir, &conn, true, 1, "2026-09-13");
        assert_eq!(list_backups(&dir).unwrap().len(), 1, "keep=1 只留最新一份");
    }
}
