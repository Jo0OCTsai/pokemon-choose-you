use crate::commands;
use crate::events;
use std::sync::OnceLock;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Builder, GlobalShortcutExt, Shortcut, ShortcutState};

/// 快速捕捉待办：唤起图鉴机并聚焦新增输入框（VPet 社区高赞需求）
pub const QUICK_CAPTURE: &str = "CmdOrCtrl+Shift+K";
/// 显示/隐藏桌宠
pub const TOGGLE_PET: &str = "CmdOrCtrl+Shift+D";

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                handle(app, shortcut);
            }
        })
        .build()
}

fn shortcut(s: &str) -> &'static Shortcut {
    static QUICK: OnceLock<Shortcut> = OnceLock::new();
    static TOGGLE: OnceLock<Shortcut> = OnceLock::new();
    match s {
        QUICK_CAPTURE => QUICK.get_or_init(|| QUICK_CAPTURE.parse().expect("合法快捷键定义")),
        _ => TOGGLE.get_or_init(|| TOGGLE_PET.parse().expect("合法快捷键定义")),
    }
}

fn handle<R: tauri::Runtime>(app: &AppHandle<R>, pressed: &Shortcut) {
    if pressed == shortcut(QUICK_CAPTURE) {
        // 主窗口可能不存在（Linux 销毁重建路径）：挂起标记让新窗口挂载后补领
        app.state::<commands::windows::QuickCapturePending>()
            .0
            .store(true, std::sync::atomic::Ordering::SeqCst);
        if let Err(e) = commands::open_main_window(app.clone()) {
            log::warn!("[shortcut] 打开主窗口失败: {e}");
        }
        let _ = app.emit(events::QUICK_CAPTURE, ());
    } else if pressed == shortcut(TOGGLE_PET) {
        commands::toggle_pet_window(app);
    }
}

/// 注册快捷键。注册失败（快捷键被其他应用占用等）只记日志不阻断启动。
pub fn register<R: tauri::Runtime>(app: &AppHandle<R>) {
    let gs = app.global_shortcut();
    for s in [shortcut(QUICK_CAPTURE), shortcut(TOGGLE_PET)] {
        if let Err(e) = gs.register(*s) {
            log::warn!("[shortcut] 注册 {s} 失败（可能被占用）: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcut_definitions_parse() {
        let q: Shortcut = QUICK_CAPTURE.parse().expect("CmdOrCtrl+Shift+K");
        let d: Shortcut = TOGGLE_PET.parse().expect("CmdOrCtrl+Shift+D");
        assert_ne!(q, d);
    }
}
