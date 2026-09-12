use crate::db::{now, Db};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::models::ImSuggestion;
use rusqlite::params;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

// ---- IM 收件箱（飞书轮询填充数据，这里提供审核命令） ----

#[tauri::command]
pub fn list_im_suggestions(db: State<Db>, status: Option<String>) -> AppResult<Vec<ImSuggestion>> {
    let conn = db.0.lock().unwrap();
    let mut stmt = conn
        .prepare("SELECT id, message_id, chat_name, sender, content, suggested_title, suggested_category, suggested_due, review_status, created_at
                  FROM im_suggestions WHERE (?1 IS NULL OR review_status=?1) ORDER BY id DESC LIMIT 300")?;
    let rows = stmt
        .query_map(params![status], |r| {
            Ok(ImSuggestion {
                id: r.get(0)?,
                message_id: r.get(1)?,
                chat_name: r.get(2)?,
                sender: r.get(3)?,
                content: r.get(4)?,
                suggested_title: r.get(5)?,
                suggested_category: r.get(6)?,
                suggested_due: r.get(7)?,
                review_status: r.get(8)?,
                created_at: r.get(9)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// 接受建议 -> 创建任务并标记已处理
#[tauri::command]
pub fn accept_im_suggestion<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
) -> AppResult<i64> {
    let conn = db.0.lock().unwrap();
    let sug: (String, Option<String>) = conn.query_row(
        "SELECT content, suggested_title FROM im_suggestions WHERE id=?1",
        params![id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let title = sug.1.unwrap_or_else(|| sug.0.chars().take(40).collect());
    conn.execute(
        "INSERT INTO tasks (title, category_id, status, source, created_at) VALUES (?1, 1, 'inbox', 'feishu', ?2)",
        params![title, now()],
    )?;
    let task_id = conn.last_insert_rowid();
    conn.execute(
        "UPDATE im_suggestions SET review_status='accepted' WHERE id=?1",
        params![id],
    )?;
    drop(conn);
    events::broadcast(&app, events::TASKS_CHANGED);
    Ok(task_id)
}

#[tauri::command]
pub fn dismiss_im_suggestion<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    db: State<Db>,
    id: i64,
) -> AppResult<()> {
    db.0.lock().unwrap().execute(
        "UPDATE im_suggestions SET review_status='dismissed' WHERE id=?1",
        params![id],
    )?;
    events::broadcast(&app, events::IM_SUGGESTIONS_CHANGED);
    Ok(())
}

// ---- 集成：AI / 飞书 / Todoist ----

#[tauri::command]
pub async fn test_ai_config(db: State<'_, Db>) -> AppResult<String> {
    let get = |k: &str| -> Option<String> {
        let conn = db.0.lock().unwrap();
        conn.query_row("SELECT value FROM settings WHERE key=?1", params![k], |r| {
            r.get::<_, String>(0)
        })
        .ok()
    };
    let cfg = crate::ai::load_config(&get)
        .ok_or_else(|| AppError::Invalid("请先填写 AI Base URL 和 API Key".into()))?;
    crate::ai::test(&cfg).await
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
    use crate::commands::tasks::{get_task, NewTask};
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

    fn seed_suggestion(app: &tauri::App<tauri::test::MockRuntime>) -> i64 {
        let db = app.state::<Db>();
        let conn = db.0.lock().unwrap();
        conn.execute(
            "INSERT INTO im_suggestions (message_id, chat_name, sender, content, suggested_title, review_status, created_at)
             VALUES ('m1', '群', '张三', '明天上午10点开周会', '参加周会', 'pending', '2026-09-01T00:00:00Z')",
            [],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn im_suggestion_list_filter_and_accept() {
        let app = setup();
        let sid = seed_suggestion(&app);
        {
            let db = app.state::<Db>();
            let pending = list_im_suggestions(db, Some("pending".into())).unwrap();
            assert_eq!(pending.len(), 1);
            assert_eq!(pending[0].suggested_title.as_deref(), Some("参加周会"));
        }
        let task_id = {
            let db = app.state::<Db>();
            accept_im_suggestion(app.handle().clone(), db, sid).unwrap()
        };
        let task = {
            let db = app.state::<Db>();
            get_task(db, task_id).unwrap()
        };
        assert_eq!(task.title, "参加周会");
        assert_eq!(task.source, "feishu");
        assert_eq!(task.status, "inbox");
        {
            let db = app.state::<Db>();
            let pending = list_im_suggestions(db, Some("pending".into())).unwrap();
            assert!(pending.is_empty(), "接受后不再 pending");
        }
    }

    #[test]
    fn im_suggestion_accept_without_title_truncates_content() {
        let app = setup();
        let sid = {
            let db = app.state::<Db>();
            let conn = db.0.lock().unwrap();
            let long = "很长的消息".repeat(20);
            conn.execute(
                "INSERT INTO im_suggestions (message_id, chat_name, sender, content, suggested_title, review_status, created_at)
                 VALUES ('m2', '', '', ?1, NULL, 'pending', '2026-09-01T00:00:00Z')",
                params![long],
            )
            .unwrap();
            conn.last_insert_rowid()
        };
        let task_id = {
            let db = app.state::<Db>();
            accept_im_suggestion(app.handle().clone(), db, sid).unwrap()
        };
        let task = {
            let db = app.state::<Db>();
            get_task(db, task_id).unwrap()
        };
        assert_eq!(task.title.chars().count(), 40, "无建议标题时截取前 40 字");
    }

    #[test]
    fn im_suggestion_dismiss() {
        let app = setup();
        let sid = seed_suggestion(&app);
        {
            let db = app.state::<Db>();
            dismiss_im_suggestion(app.handle().clone(), db, sid).unwrap();
        }
        let dismissed = {
            let db = app.state::<Db>();
            list_im_suggestions(db, Some("dismissed".into())).unwrap()
        };
        assert_eq!(dismissed.len(), 1);
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

    /// create_task 供 im 建议测试复用（保证模块间签名同步）
    #[test]
    fn new_task_shape_still_matches() {
        let t: NewTask =
            serde_json::from_value(serde_json::json!({ "title": "x", "scheduled": false }))
                .unwrap();
        assert!(!t.scheduled);
    }
}
