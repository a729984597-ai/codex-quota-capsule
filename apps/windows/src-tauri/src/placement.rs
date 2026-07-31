//! Persist user placement and restore it after display sleep/wake glitches.
//!
//! Windows often fires spurious `Moved` events (or relocates the HWND) when a
//! monitor powers off/on. Sometimes the window is parked at (-32000,-32000)
//! (minimized/off-screen) while still reporting as "visible". We only trust
//! positions saved by explicit user drag / expand-collapse, and re-apply that
//! preferred spot when the display topology changes — or when we detect the
//! HWND has been parked off-screen.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

use crate::persist::{append_diagnostic_log, read_window_position};
use crate::refresh::AppState;

static RESTORE_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

/// Re-apply the last user-saved position after a short settle delay.
pub fn restore_saved_position(app: &AppHandle, reason: &str) {
    let Some(initial_pos) = read_window_position() else {
        return;
    };
    if !is_plausible_position(initial_pos.x, initial_pos.y) {
        append_diagnostic_log(&format!(
            "placement skip bad saved pos ({:.0},{:.0})",
            initial_pos.x, initial_pos.y
        ));
        return;
    }
    if RESTORE_IN_FLIGHT.swap(true, Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    let reason = reason.to_string();
    std::thread::spawn(move || {
        // Display topology needs a moment to settle after power-on.
        for delay_ms in [250u64, 800, 1600] {
            std::thread::sleep(Duration::from_millis(delay_ms));
            // A user may drag the capsule while an older restore is settling.
            // Always use the latest explicitly saved position, never the
            // snapshot captured when this restore sequence started.
            let Some(pos) = read_window_position() else {
                continue;
            };
            if !is_plausible_position(pos.x, pos.y) {
                continue;
            }
            let app = handle.clone();
            let app_main = app.clone();
            let reason = reason.clone();
            let _ = app.run_on_main_thread(move || {
                apply_position(&app_main, &pos, &reason);
            });
        }
        RESTORE_IN_FLIGHT.store(false, Ordering::SeqCst);
    });
}

fn apply_position(app: &AppHandle, pos: &crate::model::WindowPosition, reason: &str) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    app.state::<AppState>()
        .suppress_position_save
        .store(true, Ordering::SeqCst);
    // Display sleep/wake can park the HWND at (-32000,-32000). Bring it back
    // before applying coordinates, otherwise set_position is a no-op visually.
    let _ = win.show();
    let _ = win.unminimize();
    let mut x = pos.x as i32;
    let mut y = pos.y as i32;
    if let (Ok(Some(monitor)), Ok(size)) = (win.current_monitor(), win.outer_size()) {
        // The taskbar is outside the work area but is a valid user placement.
        // Clamp only to the full monitor bounds.
        let margin = 0;
        x = clamp_axis_to_monitor(
            x,
            i32::try_from(size.width).unwrap_or(i32::MAX),
            monitor.position().x,
            i32::try_from(monitor.size().width).unwrap_or(i32::MAX),
            margin,
        );
        y = clamp_axis_to_monitor(
            y,
            i32::try_from(size.height).unwrap_or(i32::MAX),
            monitor.position().y,
            i32::try_from(monitor.size().height).unwrap_or(i32::MAX),
            margin,
        );
    }
    // Style/region changes can make the Windows shell constrain the HWND back
    // into the work area. Apply those first, then make positioning the final
    // native operation so a user-selected taskbar location survives wake-up.
    crate::layering::sync_window_layer(&win);
    set_window_position(&win, x, y);
    app.state::<AppState>()
        .suppress_position_save
        .store(false, Ordering::SeqCst);
    let actual = win
        .outer_position()
        .map(|p| format!(" observed=({},{})", p.x, p.y))
        .unwrap_or_default();
    append_diagnostic_log(&format!(
        "placement restore ({reason}) -> ({x},{y}){actual}"
    ));
}

fn set_window_position(win: &WebviewWindow, x: i32, y: i32) {
    let _ = win.set_position(PhysicalPosition::new(x, y));

    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOSIZE,
        };

        if let Ok(hwnd) = win.hwnd() {
            unsafe {
                SetWindowPos(
                    hwnd.0 as _,
                    HWND_TOPMOST,
                    x,
                    y,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }
    }
}

fn clamp_axis_to_monitor(
    position: i32,
    window_size: i32,
    work_start: i32,
    work_size: i32,
    margin: i32,
) -> i32 {
    let inset = margin.max(0);
    let min = work_start.saturating_add(inset);
    let max = work_start
        .saturating_add(work_size)
        .saturating_sub(window_size)
        .saturating_sub(inset)
        .max(min);
    position.clamp(min, max)
}

fn is_plausible_position(x: f64, y: f64) -> bool {
    // Windows parks minimized/hidden windows around (-32000,-32000).
    x > -10_000.0 && y > -10_000.0 && x < 50_000.0 && y < 50_000.0
}

fn window_is_parked_offscreen(app: &AppHandle) -> bool {
    let Some(win) = app.get_webview_window("main") else {
        return false;
    };
    match win.outer_position() {
        Ok(pos) => !is_plausible_position(pos.x as f64, pos.y as f64),
        Err(_) => false,
    }
}

/// Detect the specific shell correction seen after display wake: a capsule
/// deliberately placed over a reserved area (normally the taskbar) is moved
/// wholly back into the work area. Ordinary in-work-area positions and the
/// larger expanded window do not match this predicate.
fn window_was_moved_out_of_reserved_area(app: &AppHandle) -> bool {
    let Some(saved) = read_window_position() else {
        return false;
    };
    let Some(win) = app.get_webview_window("main") else {
        return false;
    };
    let (Ok(current), Ok(size), Ok(Some(monitor))) = (
        win.outer_position(),
        win.outer_size(),
        win.current_monitor(),
    ) else {
        return false;
    };

    let width = i32::try_from(size.width).unwrap_or(i32::MAX);
    let height = i32::try_from(size.height).unwrap_or(i32::MAX);
    let monitor_bounds = Bounds {
        x: monitor.position().x,
        y: monitor.position().y,
        width: i32::try_from(monitor.size().width).unwrap_or(i32::MAX),
        height: i32::try_from(monitor.size().height).unwrap_or(i32::MAX),
    };
    let work = monitor.work_area();
    let work_bounds = Bounds {
        x: work.position.x,
        y: work.position.y,
        width: i32::try_from(work.size.width).unwrap_or(i32::MAX),
        height: i32::try_from(work.size.height).unwrap_or(i32::MAX),
    };

    reserved_area_position_was_constrained(
        Point {
            x: saved.x as i32,
            y: saved.y as i32,
        },
        Point {
            x: current.x,
            y: current.y,
        },
        width,
        height,
        monitor_bounds,
        work_bounds,
    )
}

#[derive(Clone, Copy)]
struct Point {
    x: i32,
    y: i32,
}

#[derive(Clone, Copy)]
struct Bounds {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

fn reserved_area_position_was_constrained(
    saved: Point,
    current: Point,
    width: i32,
    height: i32,
    monitor: Bounds,
    work: Bounds,
) -> bool {
    if saved.x == current.x && saved.y == current.y {
        return false;
    }

    frame_fits(saved, width, height, monitor)
        && !frame_fits(saved, width, height, work)
        && frame_fits(current, width, height, work)
}

fn frame_fits(position: Point, width: i32, height: i32, bounds: Bounds) -> bool {
    position.x >= bounds.x
        && position.y >= bounds.y
        && position.x.saturating_add(width) <= bounds.x.saturating_add(bounds.width)
        && position.y.saturating_add(height) <= bounds.y.saturating_add(bounds.height)
}

/// Watch for monitor layout changes (sleep/wake, cable reconnect) and restore.
/// Also recover if the HWND was parked off-screen without a topology change.
pub fn start_display_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let last = Mutex::new(monitor_fingerprint());
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let next = monitor_fingerprint();
            let changed = {
                let mut guard = match last.lock() {
                    Ok(g) => g,
                    Err(_) => continue,
                };
                if *guard == next {
                    false
                } else {
                    *guard = next;
                    true
                }
            };
            if changed {
                append_diagnostic_log("display topology changed");
                restore_saved_position(&app, "display-change");
                continue;
            }
            // Catch minimize/off-screen park that didn't change monitor list.
            if !RESTORE_IN_FLIGHT.load(Ordering::SeqCst) && window_is_parked_offscreen(&app) {
                append_diagnostic_log("window parked off-screen; restoring");
                restore_saved_position(&app, "offscreen");
                continue;
            }
            if !RESTORE_IN_FLIGHT.load(Ordering::SeqCst)
                && window_was_moved_out_of_reserved_area(&app)
            {
                append_diagnostic_log("window moved out of reserved area; restoring");
                restore_saved_position(&app, "reserved-area-drift");
            }
        }
    });
}

#[cfg(windows)]
fn monitor_fingerprint() -> String {
    use std::sync::Mutex;
    use windows_sys::Win32::Foundation::{BOOL, LPARAM, RECT};
    use windows_sys::Win32::Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR};

    struct Acc {
        parts: Vec<String>,
    }
    static ACC: Mutex<Option<Acc>> = Mutex::new(None);

    unsafe extern "system" fn callback(
        _monitor: HMONITOR,
        _hdc: HDC,
        rect: *mut RECT,
        _data: LPARAM,
    ) -> BOOL {
        if rect.is_null() {
            return 1;
        }
        let r = unsafe { *rect };
        if let Ok(mut guard) = ACC.lock() {
            if let Some(acc) = guard.as_mut() {
                acc.parts
                    .push(format!("{}:{}:{}:{}", r.left, r.top, r.right, r.bottom));
            }
        }
        1
    }

    if let Ok(mut guard) = ACC.lock() {
        *guard = Some(Acc { parts: Vec::new() });
    }
    unsafe {
        EnumDisplayMonitors(std::ptr::null_mut(), std::ptr::null(), Some(callback), 0);
    }
    let parts = ACC
        .lock()
        .ok()
        .and_then(|mut g| g.take())
        .map(|a| {
            let mut p = a.parts;
            p.sort();
            p.join("|")
        })
        .unwrap_or_default();
    parts
}

#[cfg(not(windows))]
fn monitor_fingerprint() -> String {
    String::new()
}

#[cfg(test)]
mod tests {
    use super::{clamp_axis_to_monitor, reserved_area_position_was_constrained, Bounds, Point};

    #[test]
    fn keeps_a_saved_position_inside_the_taskbar() {
        assert_eq!(clamp_axis_to_monitor(1040, 37, 0, 1080, 0), 1040);
    }

    #[test]
    fn keeps_a_saved_position_inside_the_work_area() {
        assert_eq!(clamp_axis_to_monitor(900, 37, 0, 1080, 0), 900);
    }

    #[test]
    fn supports_negative_monitor_coordinates() {
        assert_eq!(clamp_axis_to_monitor(-2000, 348, -1920, 1920, 0), -1920);
    }

    #[test]
    fn detects_taskbar_position_constrained_into_work_area() {
        assert!(reserved_area_position_was_constrained(
            Point { x: 1339, y: 1039 },
            Point { x: 1339, y: 987 },
            348,
            41,
            Bounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
            Bounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1032,
            },
        ));
    }

    #[test]
    fn ignores_normal_in_work_area_movement() {
        assert!(!reserved_area_position_was_constrained(
            Point { x: 1200, y: 900 },
            Point { x: 1200, y: 850 },
            348,
            41,
            Bounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
            Bounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1032,
            },
        ));
    }

    #[test]
    fn ignores_expanded_frame_at_collapsed_saved_position() {
        assert!(!reserved_area_position_was_constrained(
            Point { x: 1339, y: 1039 },
            Point { x: 1339, y: 760 },
            348,
            320,
            Bounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
            Bounds {
                x: 0,
                y: 0,
                width: 1920,
                height: 1032,
            },
        ));
    }
}
