//! 全局输入活动强度（PET_EXPERIENCE_PROPOSAL F1 输入响应，Bongo Cat 模式）。
//!
//! 注意力红线「感知不窥探」：rdev 回调只递增一个原子计数器，每秒向桌宠窗口
//! emit `{cps}` 一个数字——永不携带按键内容、窗口标题或应用名；键盘鼠标合并计数，
//! 无法反推输入了什么。macOS 需要辅助功能权限，未授权时上层保持开关回落。

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::Emitter;

use crate::events;

static ENABLED: AtomicBool = AtomicBool::new(false);
static TICKER_RUNNING: AtomicBool = AtomicBool::new(false);
static LISTENER_STARTED: OnceLock<()> = OnceLock::new();
static COUNTER: AtomicU64 = AtomicU64::new(0);

// macOS 辅助功能授权（AXIsProcessTrusted，ApplicationServices 伞框架）；
// 输入监听在 macOS 上的前提，未授权时 rdev 收不到事件。其他平台恒 true。
#[cfg(target_os = "macos")]
mod ax {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> u8;
    }

    pub fn trusted() -> bool {
        unsafe { AXIsProcessTrusted() == 1 }
    }
}

#[cfg(target_os = "macos")]
pub fn ax_trusted() -> bool {
    ax::trusted()
}

#[cfg(not(target_os = "macos"))]
pub fn ax_trusted() -> bool {
    true
}

/// 当前进程可执行文件路径（授权指引展示；辅助功能列表里要勾选的就是它）
pub fn exe_path() -> String {
    std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// 授权引导：Finder 定位当前二进制 + 直达 系统设置→辅助功能 面板。
/// 注意这版 macOS 已禁止 AX 官方弹窗（tccd 日志 "does not allow prompting"），
/// AXIsProcessTrustedWithOptions 弹不出来，只能把用户直接送到正确的面板；
/// Finder 里选中的二进制可直接拖进授权列表（比 +/⌘⇧G 导航省事）。
#[cfg(target_os = "macos")]
pub fn open_grant_assist() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::process::Command::new("open")
            .args(["-R", &exe.to_string_lossy()])
            .status();
    }
    let _ = std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .status();
}

#[cfg(not(target_os = "macos"))]
pub fn open_grant_assist() {}

/// rdev::listen 无法停止：首次启用后回调常驻（只做一次原子加，开销可忽略），
/// 是否上报由 1s ticker 的存活决定——关闭即 ticker 退出，回调留空转。
fn ensure_listener() {
    LISTENER_STARTED.get_or_init(|| {
        std::thread::spawn(|| {
            let res = rdev::listen(|e| {
                if matches!(
                    e.event_type,
                    rdev::EventType::KeyPress(_)
                        | rdev::EventType::ButtonPress(_)
                        | rdev::EventType::Wheel { .. }
                ) {
                    COUNTER.fetch_add(1, Ordering::Relaxed);
                }
            });
            if let Err(e) = res {
                log::warn!("[input] 全局监听线程退出: {e:?}");
            }
        });
    });
}

/// 开/关上报。开启前须先通过 ax_trusted（命令层负责，这里只管线程）。
pub fn set_enabled<R: tauri::Runtime>(app: &tauri::AppHandle<R>, enabled: bool) {
    if enabled {
        ensure_listener();
        ENABLED.store(true, Ordering::SeqCst);
        if !TICKER_RUNNING.swap(true, Ordering::SeqCst) {
            let app = app.clone();
            std::thread::spawn(move || loop {
                if !ENABLED.load(Ordering::SeqCst) {
                    break;
                }
                std::thread::sleep(Duration::from_secs(1));
                let cps = COUNTER.swap(0, Ordering::Relaxed);
                // 只发桌宠窗口：主面板对输入强度没有消费方
                let _ = app.emit_to(
                    "pet",
                    events::INPUT_ACTIVITY,
                    serde_json::json!({ "cps": cps }),
                );
            });
        }
    } else {
        ENABLED.store(false, Ordering::SeqCst);
    }
}
