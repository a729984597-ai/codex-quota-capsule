mod model;
mod persist;
mod refresh;
mod tray;

use std::time::Duration;

use tauri::{Manager, PhysicalPosition};
use tauri_plugin_single_instance::init as single_instance_init;

use crate::model::WindowPosition;
use crate::persist::{read_window_position, write_window_position};
use crate::refresh::{detect_workspace_root, get_view_model, refresh_now, run_refresh, AppState};
use crate::tray::setup_tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
        .invoke_handler(tauri::generate_handler![refresh_now, get_view_model])
        .setup(|app| {
            setup_tray(app.handle())?;

            if let Some(win) = app.get_webview_window("main") {
                if let Some(pos) = read_window_position() {
                    let _ = win.set_position(PhysicalPosition::new(pos.x as i32, pos.y as i32));
                }

                let app_handle = app.handle().clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::Moved(position) = event {
                        let _ = write_window_position(&WindowPosition {
                            x: position.x as f64,
                            y: position.y as f64,
                        });
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
