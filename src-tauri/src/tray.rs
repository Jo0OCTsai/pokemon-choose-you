use crate::commands;
use crate::events;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter};

/// 托盘菜单文案（跟随应用语言设置）。桌宠常驻无标题栏，托盘是唯一常驻入口。
struct TrayLabels {
    open_dex: &'static str,
    toggle_pet: &'static str,
    settings: &'static str,
    check_update: &'static str,
    quit: &'static str,
}

fn labels(lang: &str) -> TrayLabels {
    match lang {
        "zh-Hant" => TrayLabels {
            open_dex: "開啟圖鑑機",
            toggle_pet: "顯示/隱藏桌寵",
            settings: "設定",
            check_update: "檢查更新",
            quit: "結束",
        },
        "en" => TrayLabels {
            open_dex: "Open Pokédex",
            toggle_pet: "Show/Hide Pet",
            settings: "Settings",
            check_update: "Check for Updates",
            quit: "Quit",
        },
        _ => TrayLabels {
            open_dex: "打开图鉴机",
            toggle_pet: "显示/隐藏桌宠",
            settings: "设置",
            check_update: "检查更新",
            quit: "退出",
        },
    }
}

pub const MENU_OPEN_DEX: &str = "open-dex";
pub const MENU_TOGGLE_PET: &str = "toggle-pet";
pub const MENU_SETTINGS: &str = "settings";
pub const MENU_CHECK_UPDATE: &str = "check-update";
pub const MENU_QUIT: &str = "quit";

/// 建托盘图标与菜单。菜单事件在这里分发，动作全部复用现有命令/窗口逻辑。
pub fn setup<R: tauri::Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let lang = crate::db::setting(app, "language").unwrap_or_default();
    let l = labels(&lang);
    let open_dex = MenuItem::with_id(app, MENU_OPEN_DEX, l.open_dex, true, None::<&str>)?;
    let toggle_pet = MenuItem::with_id(app, MENU_TOGGLE_PET, l.toggle_pet, true, None::<&str>)?;
    let settings = MenuItem::with_id(app, MENU_SETTINGS, l.settings, true, None::<&str>)?;
    let check_update =
        MenuItem::with_id(app, MENU_CHECK_UPDATE, l.check_update, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, l.quit, true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&open_dex, &toggle_pet, &settings, &check_update, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("就决定是你了")
        .menu(&menu)
        // 左键不弹菜单（Windows 惯例），交给 on_tray_icon_event 打开图鉴机
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| handle_menu_event(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = commands::open_main_window(tray.app_handle().clone());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn handle_menu_event<R: tauri::Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        MENU_OPEN_DEX => {
            if let Err(e) = commands::open_main_window(app.clone()) {
                log::warn!("[tray] 打开图鉴机失败: {e}");
            }
        }
        MENU_TOGGLE_PET => commands::toggle_pet_window(app),
        MENU_SETTINGS => {
            if let Err(e) = commands::open_main_window(app.clone()) {
                log::warn!("[tray] 打开主窗口失败: {e}");
                return;
            }
            let _ = app.emit(events::SHOW_SETTINGS, ());
        }
        MENU_CHECK_UPDATE => crate::commands::spawn_update_check(app.clone()),
        MENU_QUIT => app.exit(0),
        other => log::warn!("[tray] 未知菜单项: {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 三种语言都给出全部菜单文案，缺一项托盘上就是空按钮
    #[test]
    fn all_languages_have_full_labels() {
        for lang in ["zh-Hans", "zh-Hant", "en"] {
            let l = labels(lang);
            for text in [l.open_dex, l.toggle_pet, l.settings, l.check_update, l.quit] {
                assert!(!text.is_empty(), "{lang} 有缺失的托盘文案");
            }
        }
        assert_eq!(labels("zh-Hans").open_dex, "打开图鉴机");
        assert_eq!(labels("zh-Hant").quit, "結束");
        assert_eq!(labels("en").settings, "Settings");
        assert_eq!(labels("fr").open_dex, "打开图鉴机", "未知语言回退简体");
    }
}
