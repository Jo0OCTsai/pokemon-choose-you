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
    use std::ffi::c_void;
    // CF 类型走不透明指针（不引 core-foundation 依赖，只用到 C 符号）
    type CFTypeRef = *const c_void;
    pub type CFStringRef = CFTypeRef;
    type CFDictionaryRef = CFTypeRef;
    type CFAllocatorRef = CFTypeRef;
    type CFIndex = isize;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> u8;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> u8;
        static kAXTrustedCheckOptionPrompt: CFStringRef;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFDictionaryCreate(
            allocator: CFAllocatorRef,
            keys: *const CFTypeRef,
            values: *const CFTypeRef,
            num_values: CFIndex,
            key_callbacks: *const c_void,
            value_callbacks: *const c_void,
        ) -> CFDictionaryRef;
        fn CFRelease(cf: CFTypeRef);
        static kCFBooleanTrue: CFTypeRef;
    }

    pub fn trusted() -> bool {
        unsafe { AXIsProcessTrusted() == 1 }
    }

    /// 带系统弹窗的查询：未授权时 macOS 弹官方授权对话框（带「打开系统设置」），
    /// 引导用户勾选的正是当前应用，避免在系统设置里加错对象。
    /// 只在用户显式开启输入响应时调用（命令层把关），启动恢复路径用静默版。
    pub fn trusted_prompt() -> bool {
        unsafe {
            let keys: [CFTypeRef; 1] = [kAXTrustedCheckOptionPrompt];
            let values: [CFTypeRef; 1] = [kCFBooleanTrue];
            // 回调传 null = kCFTypeDictionaryKeyCallBacks/ValueCallBacks（官方允许）
            let dict = CFDictionaryCreate(
                std::ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                std::ptr::null(),
                std::ptr::null(),
            );
            let ok = AXIsProcessTrustedWithOptions(dict) == 1;
            if !dict.is_null() {
                CFRelease(dict);
            }
            ok
        }
    }
}

#[cfg(target_os = "macos")]
pub fn ax_trusted() -> bool {
    ax::trusted()
}

/// 弹系统授权对话框并返回当前授权状态（非 macOS 恒 true，不弹窗）
pub fn ax_trusted_prompt() -> bool {
    #[cfg(target_os = "macos")]
    return ax::trusted_prompt();
    #[cfg(not(target_os = "macos"))]
    true
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
