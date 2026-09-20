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
#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> u8;
}

#[cfg(target_os = "macos")]
pub fn ax_trusted() -> bool {
    unsafe { AXIsProcessTrusted() == 1 }
}

#[cfg(not(target_os = "macos"))]
pub fn ax_trusted() -> bool {
    true
}

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
