mod foreground;
mod layering;
mod model;
mod persist;
mod placement;
mod refresh;
mod tray;

use std::time::Duration;

use tauri::Manager;
use tauri_plugin_single_instance::init as single_instance_init;

use crate::layering::{invalidate_hit_region, start_layer_watcher, sync_window_layer};
use crate::persist::{append_diagnostic_log, install_panic_hook};
use crate::placement::{restore_saved_position, start_display_watcher};
use crate::refresh::{
    apply_bridge_root, detect_workspace_root, get_font_size, get_layout_mode, get_provider_order,
    get_theme_mode, get_view_model, poll_auto_switch, refresh_now, run_refresh, save_window_position,
    suppress_window_position_save, AppState,
};
use crate::tray::{handle_context_menu_event, setup_tray, show_context_menu};

fn context_menu_is_open(app: &tauri::AppHandle) -> bool {
    app.state::<AppState>()
        .context_menu_open
        .load(std::sync::atomic::Ordering::SeqCst)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_hook();
    append_diagnostic_log("app starting");

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
                let _ = win.unminimize();
                let _ = win.show();
                let _ = win.set_focus();
                crate::placement::restore_saved_position(app, "single-instance");
            }
        }))
        .manage(AppState::new(workspace_root))
        .invoke_handler(tauri::generate_handler![
            refresh_now,
            get_view_model,
            show_context_menu,
            get_font_size,
            get_layout_mode,
            get_theme_mode,
            get_provider_order,
            suppress_window_position_save,
            save_window_position
        ])
        .setup(|app| {
            // Packaged .exe: prefer bundled resources next to the binary.
            apply_bridge_root(app.handle());

            setup_tray(app.handle())?;
            start_layer_watcher(app.handle().clone());
            start_display_watcher(app.handle().clone());

            // Context menu (right-click on the capsule) events.
            app.on_menu_event(|app, event| {
                handle_context_menu_event(app, event.id.as_ref());
            });

            if let Some(win) = app.get_webview_window("main") {
                // Undecorated + shadow on Windows draws a 1px white frame / uneven corners.
                let _ = win.set_shadow(false);
                let _ = win.set_ignore_cursor_events(false);
                sync_window_layer(&win);

                // Use the same work-area-aware restore path as display wakeups.
                // A raw delayed set_position here used to overwrite the frontend clamp.
                restore_saved_position(app.handle(), "startup");

                let app_handle = app.handle().clone();
                win.on_window_event(move |event| {
                    // Do NOT persist every Moved event — display sleep/wake fires
                    // spurious moves that would overwrite the user's preferred spot.
                    // Position is saved only from user drag / expand-collapse (JS).
                    if let tauri::WindowEvent::Moved(_) = event {
                        if let Some(w) = app_handle.get_webview_window("main") {
                            sync_window_layer(&w);
                        }
                    }
                    if let tauri::WindowEvent::Resized(_) = event {
                        invalidate_hit_region();
                        if let Some(w) = app_handle.get_webview_window("main") {
                            sync_window_layer(&w);
                        }
                    }
                    if let tauri::WindowEvent::ScaleFactorChanged { .. } = event {
                        restore_saved_position(&app_handle, "dpi-change");
                    }
                    // Shell flyouts can knock the capsule out of band; re-sync
                    // when we lose focus (skip while the native menu is open).
                    if let tauri::WindowEvent::Focused(false) = event {
                        if context_menu_is_open(&app_handle) {
                            return;
                        }
                        if let Some(w) = app_handle.get_webview_window("main") {
                            sync_window_layer(&w);
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
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let _ = run_refresh(&handle);
                }));
            });

            // 60s refresh loop
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(60));
                if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let _ = run_refresh(&handle);
                }))
                .is_err()
                {
                    append_diagnostic_log("refresh loop: caught panic, continuing");
                }
            });

            // 3s foreground poll so "auto" mode switches sources promptly.
            // Window Z-order is handled by start_layer_watcher (main-thread only).
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(3));
                if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    poll_auto_switch(&handle);
                }))
                .is_err()
                {
                    append_diagnostic_log("auto-switch poll: caught panic, continuing");
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
