//! Window layering helpers for the capsule.
//!
//! Keep `HWND_TOPMOST` and clear broken hit-test / decoration state from older builds.

use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewWindow};

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

pub fn start_layer_watcher(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(3));
        let Some(win) = app.get_webview_window("main") else {
            continue;
        };
        if !win.is_visible().unwrap_or(false) {
            continue;
        }
        sync_window_layer(&win);
    });
}

pub fn invalidate_hit_region() {}
