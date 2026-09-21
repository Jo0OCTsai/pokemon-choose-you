//! 全局输入活动强度（PET_EXPERIENCE_PROPOSAL F1 输入响应，Bongo Cat 模式）。
//!
//! 注意力红线「感知不窥探」：监听回调只按事件类型递增一个原子计数器，每秒向桌宠
//! 窗口 emit `{cps}` 一个数字——永不读取按键内容、窗口标题或应用名；键盘鼠标合并计数，
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
// 输入监听在 macOS 上的前提，未授权时监听线程挂不上事件 tap。其他平台恒 true。
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

// macOS 自写最小 CGEventTap，取代 rdev：rdev 0.5.3 在监听线程里为每个按键调
// TIS 键盘布局 API（TISGetInputSourceProperty/UCKeyTranslate），这套 Carbon 调用
// 只能在主线程执行，部分 macOS 版本 × 键盘布局/输入法组合下直接段错误静默退出
// （Narsil/rdev#146；修复 PR#147 只在未发布的 main 分支）。我们只数事件次数，
// 根本不需要布局查询——listen-only tap 只看事件类型，崩溃路径整条消失。
#[cfg(target_os = "macos")]
mod tap {
    use std::ffi::c_void;
    use std::ptr;
    use std::sync::atomic::{AtomicPtr, Ordering};

    // CGEventType（CoreGraphics/CGEventTypes.h）。计数口径对齐 rdev 版：
    // 键按下、修饰键、鼠标按下、滚轮；中键（OtherMouseDown）rdev 版漏了，这里补上
    const LEFT_MOUSE_DOWN: u32 = 1;
    const RIGHT_MOUSE_DOWN: u32 = 3;
    const KEY_DOWN: u32 = 10;
    const FLAGS_CHANGED: u32 = 12;
    const SCROLL_WHEEL: u32 = 22;
    const OTHER_MOUSE_DOWN: u32 = 25;
    // 系统带外事件：tap 被禁用时回调收到的是这两种类型而非真实键鼠事件
    const TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFF_FFFE;
    const TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFF_FFFF;

    // 不订阅 MouseMoved/拖拽/KeyUp：光标移动每秒上百次会淹没按键活动，
    // rdev 版订阅后也是直接丢弃
    fn mask() -> u64 {
        1 << KEY_DOWN
            | 1 << FLAGS_CHANGED
            | 1 << LEFT_MOUSE_DOWN
            | 1 << RIGHT_MOUSE_DOWN
            | 1 << OTHER_MOUSE_DOWN
            | 1 << SCROLL_WHEEL
    }

    // 回调里拿不到创建参数，重启用 tap 端口存这里（创建后、run loop 启动前写入）
    static TAP: AtomicPtr<c_void> = AtomicPtr::new(ptr::null_mut());

    unsafe extern "C" fn raw_callback(
        _proxy: *mut c_void,
        event_type: u32,
        event: *mut c_void,
        _user_info: *mut c_void,
    ) -> *mut c_void {
        if event_type == TAP_DISABLED_BY_TIMEOUT || event_type == TAP_DISABLED_BY_USER_INPUT {
            let tap = TAP.load(Ordering::SeqCst);
            if !tap.is_null() {
                CGEventTapEnable(tap, true);
            }
            return event;
        }
        if matches!(
            event_type,
            KEY_DOWN
                | FLAGS_CHANGED
                | LEFT_MOUSE_DOWN
                | RIGHT_MOUSE_DOWN
                | OTHER_MOUSE_DOWN
                | SCROLL_WHEEL
        ) {
            super::COUNTER.fetch_add(1, Ordering::Relaxed);
        }
        event
    }

    /// 挂 tap 并进入当前线程的 run loop，常驻不返回；失败由调用方记日志
    /// （tap 创建失败基本都是辅助功能权限未授权或被收回）
    pub fn run() -> Result<(), &'static str> {
        unsafe {
            let tap = CGEventTapCreate(
                0, // kCGHIDEventTap
                0, // kCGHeadInsertEventTap
                1, // kCGEventTapOptionListenOnly：只观察不修改事件
                mask(),
                raw_callback,
                ptr::null_mut(),
            );
            if tap.is_null() {
                return Err("CGEventTapCreate 返回 null（辅助功能权限未授权/被收回？）");
            }
            TAP.store(tap, Ordering::SeqCst);
            let source = CFMachPortCreateRunLoopSource(ptr::null_mut(), tap, 0);
            if source.is_null() {
                return Err("CFMachPortCreateRunLoopSource 返回 null");
            }
            CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopCommonModes);
            CGEventTapEnable(tap, true);
            CFRunLoopRun();
        }
        Ok(())
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventTapCreate(
            tap: u32,                // CGEventTapLocation
            place: u32,              // CGEventTapPlacement
            options: u32,            // CGEventTapOptions
            events_of_interest: u64, // CGEventMask
            callback: unsafe extern "C" fn(
                *mut c_void,
                u32,
                *mut c_void,
                *mut c_void,
            ) -> *mut c_void,
            user_info: *mut c_void,
        ) -> *mut c_void;
        fn CGEventTapEnable(tap: *mut c_void, enable: bool);
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFMachPortCreateRunLoopSource(
            allocator: *mut c_void,
            port: *mut c_void,
            order: isize,
        ) -> *mut c_void;
        fn CFRunLoopGetCurrent() -> *mut c_void;
        fn CFRunLoopAddSource(rl: *mut c_void, source: *mut c_void, mode: *const c_void);
        fn CFRunLoopRun();
        static kCFRunLoopCommonModes: *const c_void;
    }
}

/// 监听无法停止：首次启用后监听线程常驻（回调只做一次原子加，开销可忽略），
/// 是否上报由 1s ticker 的存活决定——关闭即 ticker 退出，回调留空转。
fn ensure_listener() {
    LISTENER_STARTED.get_or_init(|| {
        std::thread::spawn(|| {
            #[cfg(target_os = "macos")]
            if let Err(e) = tap::run() {
                log::warn!("[input] 全局监听线程退出: {e}");
            }
            #[cfg(not(target_os = "macos"))]
            if let Err(e) = rdev::listen(|e| {
                if matches!(
                    e.event_type,
                    rdev::EventType::KeyPress(_)
                        | rdev::EventType::ButtonPress(_)
                        | rdev::EventType::Wheel { .. }
                ) {
                    COUNTER.fetch_add(1, Ordering::Relaxed);
                }
            }) {
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
