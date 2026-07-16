use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::refresh::{run_refresh, AppState};

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_i = MenuItem::with_id(app, "show", "显示胶囊", true, None::<&str>)?;
    let hide_i = MenuItem::with_id(app, "hide", "隐藏胶囊", true, None::<&str>)?;
    let refresh_i = MenuItem::with_id(app, "refresh", "立即刷新", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &hide_i, &refresh_i, &quit_i])?;

    let tooltip = app
        .try_state::<AppState>()
        .and_then(|s| s.view_model.lock().ok().map(|vm| vm.tooltip()))
        .unwrap_or_else(|| "Quota Capsule Beta".into());

    let _tray = TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .tooltip(&tooltip)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
            "hide" => {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }
            "refresh" => {
                let handle = app.clone();
                let _ = std::thread::spawn(move || {
                    let _ = run_refresh(&handle);
                });
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.show();
                    let _ = win.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(())
}
