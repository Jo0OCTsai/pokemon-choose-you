use crate::error::{AppError, AppResult};
use tauri::Manager;

/// 桌宠请求重开主窗口的标记（Linux 销毁重建路径用），启动时 manage 进应用状态
pub struct PendingMainReopen(pub std::sync::atomic::AtomicBool);

/// 全局快捷键"快速捕捉"的挂起标记：Linux 上主窗口销毁重建后新窗口才挂载，
/// emit 的事件会被错过，主窗口启动时来这里补领一次
pub struct QuickCapturePending(pub std::sync::atomic::AtomicBool);

/// 主窗口挂载时调用：有挂起的快速捕捉请求则消费掉（一次性）
#[tauri::command]
pub fn consume_quick_capture<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> bool {
    use std::sync::atomic::Ordering;
    app.state::<QuickCapturePending>()
        .0
        .swap(false, Ordering::SeqCst)
}

/// main 窗口 Destroyed 时由 lib.rs 的 run 回调调用：有挂起请求才重建，用户自己关闭不重建。
/// 该回调收到 Destroyed 时 label 已从管理器注销，此处建新窗口无同名冲突。
pub fn reopen_main_if_pending<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use std::sync::atomic::Ordering;
    if !app
        .state::<PendingMainReopen>()
        .0
        .swap(false, Ordering::SeqCst)
    {
        return;
    }
    if let Err(e) = build_main_window(app) {
        log::error!("[open_main_window] 销毁后重建失败: {e}");
    }
}

/// 双击桌宠/托盘/单实例回调共用的打开主窗口入口。
/// Windows/macOS：存在则恢复（含最小化）并置前；
/// Linux（WSLg/Wayland）：最小化状态在应用侧失真、Wayland 又不允许客户端自行激活窗口，
/// 强制重映射会冻住标题栏按钮，因此统一销毁重建（状态都在库里，重建即恢复）。
#[tauri::command]
pub fn open_main_window<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> AppResult<()> {
    if let Some(win) = app.get_webview_window("main") {
        #[cfg(target_os = "linux")]
        {
            use std::sync::atomic::Ordering;
            log::info!(
                "[open_main_window] linux 销毁重建（最小化探测失真: {}）",
                win.is_minimized().unwrap_or(false)
            );
            match win.destroy() {
                Ok(()) => app
                    .state::<PendingMainReopen>()
                    .0
                    .store(true, Ordering::SeqCst),
                Err(e) => log::warn!("[open_main_window] destroy 失败: {e}"),
            }
            // 重建在 run 事件的 Destroyed 回调（reopen_main_if_pending）里完成
        }
        #[cfg(not(target_os = "linux"))]
        {
            // 最小化的窗口 set_focus 是 no-op，必须先恢复；
            // 盲目 restore 会顺带取消最大化，需先探测
            if win.is_minimized().unwrap_or(false) {
                let _ = win.unminimize();
            }
            win.show()?;
            let _ = win.set_focus();
        }
    } else {
        build_main_window(&app)?;
    }
    Ok(())
}

fn build_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> AppResult<()> {
    tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
        .title("就决定是你了")
        .inner_size(980.0, 700.0)
        .min_inner_size(760.0, 540.0)
        .build()
        .map_err(|e| AppError::External(format!("主窗口创建失败: {e}")))?;
    Ok(())
}

/// 托盘"显示/隐藏桌宠"与全局快捷键共用：切换桌宠窗口可见性
pub fn toggle_pet_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(win) = app.get_webview_window("pet") {
        if win.is_visible().unwrap_or(true) {
            let _ = win.hide();
        } else {
            let _ = win.show();
        }
    }
}

/// 关闭主窗口的去向：true=隐藏到托盘（默认，常驻惯例），false=真关闭
pub fn close_to_tray_enabled<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    parse_close_to_tray(crate::db::setting(app, "close_to_tray").as_deref())
}

/// 只有显式 "false" 才真关闭；未设置/空/异常值都回退隐藏（托盘常驻应用的安全默认）
fn parse_close_to_tray(v: Option<&str>) -> bool {
    !matches!(v, Some("false"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::tests::test_conn;
    use crate::db::Db;
    use std::sync::Mutex;

    fn setup() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(Db(Mutex::new(test_conn())));
        app.manage(PendingMainReopen(std::sync::atomic::AtomicBool::new(false)));
        app
    }

    /// 双击桌宠打开主窗口：不存在时直接重建；存在时（Linux）销毁并挂起重开，
    /// 重建由 Destroyed 事件回调（reopen_main_if_pending）完成，用户自行关闭不触发重建
    #[test]
    fn open_main_window_rebuilds_and_marks_reopen() {
        use std::sync::atomic::Ordering;
        let app = setup();
        assert!(
            app.get_webview_window("main").is_none(),
            "mock 初始没有 main 窗口"
        );
        open_main_window(app.handle().clone()).expect("首次调用走重建分支");
        assert!(
            app.get_webview_window("main").is_some(),
            "关闭后应重建 main 窗口"
        );
        // 再次调用（窗口存在）：销毁并挂起重开；mock 不驱动事件循环，Destroyed 回调由下方手动模拟
        open_main_window(app.handle().clone()).expect("再次调用销毁旧窗口");
        assert!(
            app.state::<PendingMainReopen>().0.load(Ordering::SeqCst),
            "应挂起重开请求"
        );
        reopen_main_if_pending(app.handle());
        assert!(
            !app.state::<PendingMainReopen>().0.load(Ordering::SeqCst),
            "Destroyed 回调应消费标记"
        );
        // 用户自行关闭（无挂起请求）时再次进入回调，不应触发重建
        reopen_main_if_pending(app.handle());
    }

    /// 关闭到托盘的设置解析：默认隐藏，仅显式 false 关闭
    #[test]
    fn close_to_tray_defaults_to_hide() {
        assert!(parse_close_to_tray(None), "未设置时默认隐藏到托盘");
        assert!(parse_close_to_tray(Some("")), "空串回退默认");
        assert!(parse_close_to_tray(Some("true")));
        assert!(
            parse_close_to_tray(Some("yes")),
            "非 false 的异常值回退默认"
        );
        assert!(!parse_close_to_tray(Some("false")), "显式 false 才真关闭");
    }
}
