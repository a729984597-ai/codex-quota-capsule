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
    use windows_sys::Win32::Graphics::Gdi::{CreateRoundRectRgn, DeleteObject, SetWindowRgn};
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
        if let Ok(size) = win.inner_size() {
            let width = i32::try_from(size.width).unwrap_or(i32::MAX);
            let height = i32::try_from(size.height).unwrap_or(i32::MAX);
            let display_scale = win.scale_factor().unwrap_or(1.0);
            let font_scale = current_font_scale(win);
            let diameter = rounded_region_diameter(width, height, font_scale, display_scale);
            let region = CreateRoundRectRgn(
                0,
                0,
                width,
                height,
                diameter,
                diameter,
            );
            if !region.is_null() && SetWindowRgn(hwnd as _, region, 1) == 0 {
                // SetWindowRgn owns the region only when it succeeds.
                DeleteObject(region);
            }
        }
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

fn current_font_scale(win: &WebviewWindow) -> f64 {
    win.app_handle()
        .try_state::<crate::refresh::AppState>()
        .and_then(|state| {
            state.font_size.lock().ok().map(|size| match size.as_str() {
                "large" => 1.3,
                "xlarge" => 1.45,
                "small" => 1.0,
                _ => 1.15,
            })
        })
        .unwrap_or(1.15)
}

fn rounded_region_diameter(width: i32, height: i32, font_scale: f64, display_scale: f64) -> i32 {
    let short_edge = width.min(height).max(0);
    if short_edge == 0 {
        return 0;
    }

    // Collapsed capsules are pills. Expanded panels retain the CSS 14px radius.
    let collapsed_limit = (80.0 * display_scale).round() as i32;
    if height <= collapsed_limit {
        return short_edge;
    }

    let css_diameter = (28.0 * font_scale * display_scale).round() as i32;
    css_diameter.clamp(1, short_edge)
}

#[cfg(test)]
mod tests {
    use super::rounded_region_diameter;

    #[test]
    fn collapsed_capsule_uses_full_height_for_pill_shape() {
        assert_eq!(rounded_region_diameter(348, 41, 1.45, 1.0), 41);
    }

    #[test]
    fn expanded_capsule_scales_the_css_corner_diameter() {
        assert_eq!(rounded_region_diameter(319, 304, 1.45, 1.0), 41);
    }

    #[test]
    fn rounded_region_is_clamped_to_the_shorter_edge() {
        assert_eq!(rounded_region_diameter(20, 40, 1.45, 1.0), 20);
    }
}
