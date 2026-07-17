mod foreground;
mod model;
mod persist;
mod refresh;
mod tray;

use std::time::Duration;

use tauri::{Manager, PhysicalPosition};
use tauri_plugin_single_instance::init as single_instance_init;

use crate::model::WindowPosition;
use crate::persist::{read_window_position, write_window_position};
use crate::refresh::{
    apply_bridge_root, detect_workspace_root, get_font_size, get_layout_mode, get_view_model,
    poll_auto_switch, refresh_now, run_refresh, save_window_position,
    suppress_window_position_save, AppState,
};
use crate::tray::{handle_context_menu_event, setup_tray, show_context_menu};

/// Re-insert the window into the topmost band. `set_always_on_top(true)` is a
/// no-op when the flag is already set, so shell flyouts (tray overflow etc.)
/// that push us down need an explicit SetWindowPos.
#[cfg(windows)]
fn force_topmost(win: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };
    if let Ok(hwnd) = win.hwnd() {
        unsafe {
            SetWindowPos(
                hwnd.0 as _,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
}

#[cfg(not(windows))]
fn force_topmost(win: &tauri::WebviewWindow) {
    let _ = win.set_always_on_top(true);
}

fn context_menu_is_open(app: &tauri::AppHandle) -> bool {
    app.state::<AppState>()
        .context_menu_open
        .load(std::sync::atomic::Ordering::SeqCst)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Prevent WebView2 from filling rounded transparent pixels with white.
    #[cfg(windows)]
    {
        std::env::set_var("WEBVIEW2_DEFAULT_BACKGROUND_COLOR", "0x00000000");
    }

    let workspace_root = detect_workspace_root();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(single_instance_init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .manage(AppState::new(workspace_root))
        .invoke_handler(tauri::generate_handler![
            refresh_now,
            get_view_model,
            show_context_menu,
            get_font_size,
            get_layout_mode,
            suppress_window_position_save,
            save_window_position
        ])
        .setup(|app| {
            // Packaged .exe: prefer bundled resources next to the binary.
            apply_bridge_root(app.handle());

            setup_tray(app.handle())?;

            // Context menu (right-click on the capsule) events.
            app.on_menu_event(|app, event| {
                handle_context_menu_event(app, event.id.as_ref());
            });

            if let Some(win) = app.get_webview_window("main") {
                // Undecorated + shadow on Windows draws a 1px white frame / uneven corners.
                let _ = win.set_shadow(false);

                if let Some(pos) = read_window_position() {
                    let _ = win.set_position(PhysicalPosition::new(pos.x as i32, pos.y as i32));
                    // WebView init can reset placement; re-apply shortly after show.
                    let win_restore = win.clone();
                    let restore_pos = pos.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(400));
                        let _ = win_restore.set_position(PhysicalPosition::new(
                            restore_pos.x as i32,
                            restore_pos.y as i32,
                        ));
                    });
                }

                let app_handle = app.handle().clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::Moved(position) = event {
                        let suppress = app_handle
                            .state::<AppState>()
                            .suppress_position_save
                            .load(std::sync::atomic::Ordering::SeqCst);
                        if !suppress {
                            let _ = write_window_position(&WindowPosition {
                                x: position.x as f64,
                                y: position.y as f64,
                            });
                        }
                    }
                    // Shell flyouts (tray overflow etc.) can knock the capsule
                    // out of the topmost band; re-assert when we lose focus.
                    // Skip while the native context menu is open — otherwise
                    // Focused(false) from the popup covers the menu itself.
                    if let tauri::WindowEvent::Focused(false) = event {
                        if context_menu_is_open(&app_handle) {
                            return;
                        }
                        if let Some(w) = app_handle.get_webview_window("main") {
                            force_topmost(&w);
                        }
                    }
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Hide to tray instead of quitting
                        api.prevent_close();
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                });
            }

            // Load last success into UI immediately if present
            if let Some(saved) = crate::persist::read_last_success() {
                if let Ok(mut vm) = app.state::<AppState>().view_model.lock() {
                    *vm = saved.view_model;
                }
            }

            // Immediate refresh on launch
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let _ = run_refresh(&handle);
            });

            // 60s refresh loop
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(60));
                let _ = run_refresh(&handle);
            });

            // 3s foreground poll so "auto" mode switches sources promptly;
            // also re-assert topmost so shell flyouts can't bury us.
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(3));
                poll_auto_switch(&handle);
                if context_menu_is_open(&handle) {
                    continue;
                }
                if let Some(win) = handle.get_webview_window("main") {
                    if win.is_visible().unwrap_or(false) {
                        force_topmost(&win);
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
