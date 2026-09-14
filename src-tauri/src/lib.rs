pub mod ai;
pub mod backup;
// db / models / error / commands 对外公开：pk CLI（src/bin/pk.rs）以 crate 库形式复用同一套数据逻辑
pub mod commands;
pub mod db;
pub mod error;
mod events;
mod feishu;
mod health;
mod lark_cli;
pub mod models;
mod scheduler;
mod secrets;
mod shortcuts;
mod todoist;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // 单实例必须最先注册：二次启动唤起已有实例的主窗口后自行退出，
        // 否则两只桌宠并存 + 两个进程争抢同一个 SQLite 文件
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            log::info!("[single-instance] 检测到二次启动，唤起主窗口");
            let _ = commands::open_main_window(app.clone());
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // 只记忆窗口位置不记忆尺寸：桌宠快捷屏展开时会把窗口临时调高，
        // 记忆尺寸会把这块透明区带到下次启动，挡住下层应用的点击
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .build(),
        )
        .plugin(shortcuts::plugin())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .max_file_size(512_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .setup(|app| {
            use tauri::Manager;
            // panic 显式捕获进轮转日志（诊断页/支持报告可见），再交还默认 hook 保留 stderr 输出
            let default_panic = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                log::error!(
                    "[panic] {info}\n{}",
                    std::backtrace::Backtrace::force_capture()
                );
                default_panic(info);
            }));
            // macOS：桌宠型常驻应用不占 Dock 图标（Accessory），入口收敛到托盘与快捷键。
            // Builder 上无此方法，须在 App 上设置（macOS 专属 API）
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            db::init(app.handle())?;
            app.manage(commands::windows::PendingMainReopen(
                std::sync::atomic::AtomicBool::new(false),
            ));
            app.manage(commands::windows::QuickCapturePending(
                std::sync::atomic::AtomicBool::new(false),
            ));
            app.manage(health::HealthState::default());
            scheduler::spawn_reminder_loop(app.handle().clone());
            backup::spawn_daily_loop(app.handle().clone());
            feishu::spawn_poll_loop(app.handle().clone());
            tray::setup(app.handle())?;
            shortcuts::register(app.handle());
            commands::spawn_update_check(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::export_json,
            commands::import_json,
            commands::export_tasks_csv,
            commands::export_daily_md,
            commands::open_exports_dir,
            commands::log_agent_session,
            commands::list_agent_sessions,
            commands::list_backups,
            commands::create_backup_now,
            commands::restore_backup,
            commands::list_tasks,
            commands::dex_stats,
            commands::search_tasks,
            commands::create_task,
            commands::get_task,
            commands::update_task,
            commands::delete_task,
            commands::list_task_notes,
            commands::add_task_note,
            commands::delete_task_note,
            commands::list_task_logs,
            commands::start_task,
            commands::pause_current_task,
            commands::get_current_task,
            commands::add_focus_seconds,
            commands::list_tags,
            commands::create_tag,
            commands::update_tag,
            commands::delete_tag,
            commands::list_categories,
            commands::set_category_pokemon,
            commands::set_category_enabled,
            commands::create_category,
            commands::update_category,
            commands::delete_category,
            commands::get_setting,
            commands::set_setting,
            commands::list_all_settings,
            commands::list_chat_messages,
            commands::accept_chat_message,
            commands::dismiss_chat_message,
            commands::batch_review_chat_messages,
            commands::force_create_todo,
            commands::apply_chat_message_update,
            commands::test_ai_config,
            commands::open_agent_history,
            commands::setup_remote_pk,
            commands::test_feishu_config,
            commands::trigger_feishu_poll,
            commands::feishu_oauth_login,
            commands::feishu_oauth_status,
            commands::sync_todoist,
            commands::integration_health,
            commands::list_log_entries,
            commands::build_support_report,
            commands::check_update,
            commands::install_update,
            commands::open_main_window,
            commands::consume_quick_capture,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // 关闭主窗口 → 隐藏到托盘（常驻应用惯例；退出入口在托盘菜单）。设置可改为真关闭。
        if let tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::CloseRequested { api, .. },
            ..
        } = &event
        {
            if label == "main" && commands::windows::close_to_tray_enabled(app_handle) {
                use tauri::Manager;
                api.prevent_close();
                if let Some(win) = app_handle.get_webview_window("main") {
                    use tauri_plugin_window_state::AppHandleExt;
                    // 隐藏即长期驻留：显式落一次窗口状态（与插件配置一致只存 POSITION），
                    // 避免退出时 Destroyed 时序漏存
                    let _ = app_handle
                        .save_window_state(tauri_plugin_window_state::StateFlags::POSITION);
                    let _ = win.hide();
                }
            }
        }
        // main 窗口销毁后按需重建（Linux 上桌宠双击走销毁重开路径）。
        // 回调收到 Destroyed 时 label 已从管理器注销，直接建新窗口无同名冲突。
        if let tauri::RunEvent::WindowEvent {
            label,
            event: tauri::WindowEvent::Destroyed,
            ..
        } = event
        {
            if label == "main" {
                commands::reopen_main_if_pending(app_handle);
            }
        }
    });
}
