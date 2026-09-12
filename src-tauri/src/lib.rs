mod ai;
mod commands;
mod db;
mod feishu;
mod models;
mod scheduler;
mod todoist;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) { log::LevelFilter::Debug } else { log::LevelFilter::Info })
                .max_file_size(512_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
                .build(),
        )
        .setup(|app| {
            use tauri::Manager;
            db::init(&app.handle())?;
            app.manage(commands::PendingMainReopen(std::sync::atomic::AtomicBool::new(false)));
            scheduler::spawn_reminder_loop(app.handle().clone());
            feishu::spawn_poll_loop(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_tasks,
            commands::create_task,
            commands::get_task,
            commands::update_task,
            commands::delete_task,
            commands::start_task,
            commands::pause_current_task,
            commands::get_current_task,
            commands::add_focus_seconds,
            commands::list_categories,
            commands::set_category_pokemon,
            commands::get_setting,
            commands::set_setting,
            commands::list_im_suggestions,
            commands::accept_im_suggestion,
            commands::dismiss_im_suggestion,
            commands::test_ai_config,
            commands::test_feishu_config,
            commands::trigger_feishu_poll,
            commands::sync_todoist,
            commands::list_all_settings,
            commands::open_main_window,
            commands::create_category,
            commands::update_category,
            commands::delete_category,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        // main 窗口销毁后按需重建（Linux 上桌宠双击走销毁重开路径）。
        // 回调收到 Destroyed 时 label 已从管理器注销，直接建新窗口无同名冲突。
        if let tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } = event {
            if label == "main" {
                commands::reopen_main_if_pending(app_handle);
            }
        }
    });
}
