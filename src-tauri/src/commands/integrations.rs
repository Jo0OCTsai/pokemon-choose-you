use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::events;
use crate::models::AiLog;
use rusqlite::params;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

// ---- 集成：AI / 飞书 / Todoist ----

#[tauri::command]
pub async fn test_ai_config(db: State<'_, Db>) -> AppResult<String> {
    let cfg = {
        let conn = db.0.lock().unwrap();
        let get = |k: &str| -> Option<String> {
            conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
                r.get::<_, String>(0)
            })
            .ok()
        };
        crate::ai::load_config(&get)
            .ok_or_else(|| AppError::Invalid("请先填写 AI Base URL 和 API Key".into()))?
    };
    let (res, record) = crate::ai::test(&cfg).await;
    crate::ai::save_log(&db, &record);
    res
}

#[tauri::command]
pub async fn test_feishu_config(db: State<'_, Db>) -> AppResult<String> {
    let get = |k: &str| -> Option<String> {
        let conn = db.0.lock().unwrap();
        conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
            r.get::<_, String>(0)
        })
        .ok()
    };
    let cfg = crate::feishu::load_config(&get)
        .ok_or_else(|| AppError::Invalid("请先填写飞书 App ID / App Secret".into()))?;
    crate::feishu::poll_once_test(&cfg).await
}

#[tauri::command]
pub async fn trigger_feishu_poll(app: AppHandle) -> AppResult<usize> {
    crate::feishu::poll_once(&app).await
}

#[tauri::command]
pub async fn sync_todoist(app: AppHandle) -> AppResult<String> {
    crate::todoist::sync(&app).await
}

// ---- AI 链路可观测性：请求/响应留痕查看 ----

#[tauri::command]
pub fn list_ai_logs(db: State<Db>, limit: Option<i64>) -> AppResult<Vec<AiLog>> {
    let limit = limit.unwrap_or(50).clamp(1, 200);
    let conn = db.0.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, scene, model, request_body, response_body, ok, error, duration_ms, created_at
         FROM ai_logs ORDER BY id DESC LIMIT ?1",
    )?;
    let rows = stmt
        .query_map(params![limit], |r| {
            Ok(AiLog {
                id: r.get(0)?,
                scene: r.get(1)?,
                model: r.get(2)?,
                request_body: r.get(3)?,
                response_body: r.get(4)?,
                ok: r.get::<_, i64>(5)? != 0,
                error: r.get(6)?,
                duration_ms: r.get(7)?,
                created_at: r.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

#[tauri::command]
pub fn clear_ai_logs(db: State<Db>) -> AppResult<()> {
    db.0.lock().unwrap().execute("DELETE FROM ai_logs", [])?;
    Ok(())
}

// ---- 自动更新（tauri-plugin-updater，endpoint/公钥在 tauri.conf.json） ----

#[tauri::command]
pub async fn check_update(app: AppHandle) -> AppResult<String> {
    let updater = app
        .updater()
        .map_err(|e| AppError::External(format!("更新器初始化失败: {e}")))?;
    match updater.check().await {
        Ok(Some(update)) => Ok(update.version),
        Ok(None) => Ok(String::new()),
        Err(e) => Err(AppError::Network(format!("检查更新失败: {e}"))),
    }
}

/// 下载并安装更新，成功后重启应用（安装包由发布流水线 minisign 签名，公钥内置于配置）
#[tauri::command]
pub async fn install_update(app: AppHandle) -> AppResult<()> {
    let updater = app
        .updater()
        .map_err(|e| AppError::External(format!("更新器初始化失败: {e}")))?;
    let update = updater
        .check()
        .await
        .map_err(|e| AppError::Network(format!("检查更新失败: {e}")))?
        .ok_or_else(|| AppError::NotFound("当前已是最新版本".into()))?;
    let progress_app = app.clone();
    update
        .download_and_install(
            move |downloaded, total| {
                // 下载进度推给设置页展示（downloaded/total 为字节）
                let _ = progress_app.emit(
                    crate::events::UPDATE_PROGRESS,
                    serde_json::json!({ "downloaded": downloaded, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| AppError::External(format!("下载安装失败: {e}")))?;
    app.restart();
}

/// 启动/托盘触发更新检查：发现新版本广播给前端（未配置 updater 时静默跳过，不打扰）
pub fn spawn_update_check<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        match app.updater() {
            Ok(updater) => match updater.check().await {
                Ok(Some(update)) => {
                    log::info!(
                        "发现新版本 v{}（安装入口：托盘菜单 / 设置页）",
                        update.version
                    );
                    let _ = app.emit(events::UPDATE_AVAILABLE, update.version.clone());
                }
                Ok(None) => {}
                Err(e) => log::debug!("更新检查跳过（未配置或网络不可用）: {e}"),
            },
            Err(e) => log::debug!("更新器不可用（未配置 endpoint）: {e}"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::AiCallRecord;
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
    fn ai_logs_list_order_limit_and_clear() {
        let app = setup();
        {
            let db = app.state::<Db>();
            for i in 1..=5 {
                crate::ai::save_log(
                    &db,
                    &AiCallRecord {
                        scene: "classify".into(),
                        model: format!("m{i}"),
                        request: format!("req{i}"),
                        response: format!("resp{i}"),
                        ok: true,
                        error: None,
                        duration_ms: i * 10,
                    },
                );
            }
        }
        let logs = {
            let db = app.state::<Db>();
            list_ai_logs(db, Some(3)).unwrap()
        };
        assert_eq!(logs.len(), 3);
        assert_eq!(logs[0].model, "m5", "最新在前");
        assert_eq!(logs[0].duration_ms, 50);
        let all = {
            let db = app.state::<Db>();
            list_ai_logs(db, None).unwrap()
        };
        assert_eq!(all.len(), 5, "默认拉全部（≤ 上限）");
        {
            let db = app.state::<Db>();
            clear_ai_logs(db).unwrap();
        }
        let empty = {
            let db = app.state::<Db>();
            list_ai_logs(db, None).unwrap()
        };
        assert!(empty.is_empty());
    }

    #[test]
    fn test_ai_config_without_credentials_is_invalid_input() {
        let app = setup();
        let db = app.state::<Db>();
        let err = tauri::async_runtime::block_on(test_ai_config(db)).unwrap_err();
        assert!(
            matches!(err, AppError::Invalid(_)),
            "缺配置应归为输入错误: {err}"
        );
    }
}
