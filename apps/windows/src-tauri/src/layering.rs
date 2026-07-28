//! Window layering helpers for the capsule.
//!
//! Keep `HWND_TOPMOST` and clear broken hit-test / decoration state from older builds.
//! Window/Tauri API calls must run on the main thread — background threads only
//! schedule work via `AppHandle::run_on_main_thread`.

use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewWindow};

use crate::persist::append_diagnostic_log;

/// Re-assert topmost and clear leftover click-through / region state.
#[cfg(windows)]
pub fn sync_window_layer(win: &WebviewWindow) {
    use windows_sys::Win32::Graphics::Gdi::SetWindowRgn;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };

    let Ok(hwnd) = win.hwnd() else {
        return;
    };
    let hwnd = hwnd.0 as isize;

    let _ = win.set_ignore_cursor_events(false);
    let _ = win.set_decorations(false);
    let _ = win.set_shadow(false);

    unsafe {
        SetWindowRgn(hwnd as _, std::ptr::null_mut(), 1);
        SetWindowPos(
            hwnd as _,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

#[cfg(not(windows))]
pub fn sync_window_layer(win: &WebviewWindow) {
    let _ = win.set_always_on_top(true);
    let _ = win.set_ignore_cursor_events(false);
}

/// Schedule `sync_window_layer` on the UI thread (safe from worker threads).
pub fn request_sync_window_layer(app: &AppHandle) {
    let app = app.clone();
    let app_main = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(win) = app_main.get_webview_window("main") {
            if win.is_visible().unwrap_or(false) {
                sync_window_layer(&win);
            }
        }
    });
}

pub fn start_layer_watcher(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(3));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if app
                .state::<crate::refresh::AppState>()
                .context_menu_open
                .load(std::sync::atomic::Ordering::SeqCst)
            {
                return;
            }
            request_sync_window_layer(&app);
        }));
        if result.is_err() {
            append_diagnostic_log("layer watcher: caught panic, continuing");
        }
    });
}

pub fn invalidate_hit_region() {}
