use tauri::menu::{CheckMenuItem, ContextMenu, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::refresh::{
    current_font_size, current_layout_mode, current_provider_mode, run_refresh, set_font_size,
    set_layout_mode, set_provider_mode, AppState,
};

/// Right-click context menu on the capsule window (replaces the WebView2
/// default). Items use "ctx_" ids so they don't collide with the tray menu.
#[tauri::command]
pub fn show_context_menu(window: tauri::Window) -> Result<(), String> {
    let app = window.app_handle().clone();
    let mode = current_provider_mode(&app);
    let font = current_font_size(&app);
    let layout = current_layout_mode(&app);

    let build = || -> tauri::Result<Menu<tauri::Wry>> {
        let refresh_i =
            MenuItem::with_id(&app, "ctx_refresh", "立即刷新", true, None::<&str>)?;
        let hide_i = MenuItem::with_id(&app, "ctx_hide", "隐藏胶囊", true, None::<&str>)?;
        let auto_i = CheckMenuItem::with_id(
            &app, "ctx_prov_auto", "自动", true, mode == "auto", None::<&str>,
        )?;
        let cursor_i = CheckMenuItem::with_id(
            &app, "ctx_prov_cursor", "仅 Cursor", true, mode == "cursor", None::<&str>,
        )?;
        let codex_i = CheckMenuItem::with_id(
            &app, "ctx_prov_codex", "仅 Codex", true, mode == "codex", None::<&str>,
        )?;
        let both_i = CheckMenuItem::with_id(
            &app, "ctx_prov_both", "都显示", true, mode == "both", None::<&str>,
        )?;
        let provider_menu = Submenu::with_items(
            &app,
            "监控源",
            true,
            &[&auto_i, &cursor_i, &codex_i, &both_i],
        )?;
        let layout_standard_i = CheckMenuItem::with_id(
            &app, "ctx_layout_standard", "标准", true, layout == "standard", None::<&str>,
        )?;
        let layout_minimal_i = CheckMenuItem::with_id(
            &app, "ctx_layout_minimal", "极简", true, layout == "minimal", None::<&str>,
        )?;
        let layout_menu = Submenu::with_items(
            &app,
            "显示",
            true,
            &[&layout_standard_i, &layout_minimal_i],
        )?;
        let font_small_i = CheckMenuItem::with_id(
            &app, "ctx_font_small", "小", true, font == "small", None::<&str>,
        )?;
        let font_standard_i = CheckMenuItem::with_id(
            &app, "ctx_font_standard", "标准", true, font == "standard", None::<&str>,
        )?;
        let font_large_i = CheckMenuItem::with_id(
            &app, "ctx_font_large", "大", true, font == "large", None::<&str>,
        )?;
        let font_xlarge_i = CheckMenuItem::with_id(
            &app, "ctx_font_xlarge", "更大", true, font == "xlarge", None::<&str>,
        )?;
        let font_menu = Submenu::with_items(
            &app,
            "字体大小",
            true,
            &[&font_small_i, &font_standard_i, &font_large_i, &font_xlarge_i],
        )?;
        let sep = PredefinedMenuItem::separator(&app)?;
        let quit_i = MenuItem::with_id(&app, "ctx_quit", "退出", true, None::<&str>)?;
        Menu::with_items(
            &app,
            &[
                &refresh_i,
                &hide_i,
                &sep,
                &provider_menu,
                &layout_menu,
                &font_menu,
                &sep,
                &quit_i,
            ],
        )
    };

    let menu = build().map_err(|e| e.to_string())?;
    menu.popup(window).map_err(|e| e.to_string())
}

/// Handle context-menu item clicks (registered via `app.on_menu_event`).
pub fn handle_context_menu_event(app: &AppHandle, id: &str) {
    match id {
        "ctx_refresh" => {
            let handle = app.clone();
            let _ = std::thread::spawn(move || {
                let _ = run_refresh(&handle);
            });
        }
        "ctx_hide" => {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.hide();
            }
        }
        "ctx_prov_auto" | "ctx_prov_cursor" | "ctx_prov_codex" | "ctx_prov_both" => {
            let mode = id.trim_start_matches("ctx_prov_").to_string();
            let handle = app.clone();
            let _ = std::thread::spawn(move || {
                let _ = set_provider_mode(&handle, &mode);
            });
        }
        "ctx_layout_standard" | "ctx_layout_minimal" => {
            let mode = id.trim_start_matches("ctx_layout_").to_string();
            let _ = set_layout_mode(app, &mode);
        }
        "ctx_font_small" | "ctx_font_standard" | "ctx_font_large" | "ctx_font_xlarge" => {
            let size = id.trim_start_matches("ctx_font_").to_string();
            let _ = set_font_size(app, &size);
        }
        "ctx_quit" => {
            app.exit(0);
        }
        _ => {}
    }
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show_i = MenuItem::with_id(app, "show", "显示胶囊", true, None::<&str>)?;
    let hide_i = MenuItem::with_id(app, "hide", "隐藏胶囊", true, None::<&str>)?;
    let refresh_i = MenuItem::with_id(app, "refresh", "立即刷新", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

    let mode = current_provider_mode(app);
    let auto_i = CheckMenuItem::with_id(app, "prov_auto", "自动", true, mode == "auto", None::<&str>)?;
    let cursor_i =
        CheckMenuItem::with_id(app, "prov_cursor", "仅 Cursor", true, mode == "cursor", None::<&str>)?;
    let codex_i =
        CheckMenuItem::with_id(app, "prov_codex", "仅 Codex", true, mode == "codex", None::<&str>)?;
    let both_i =
        CheckMenuItem::with_id(app, "prov_both", "都显示", true, mode == "both", None::<&str>)?;
    let provider_menu = Submenu::with_items(
        app,
        "监控源",
        true,
        &[&auto_i, &cursor_i, &codex_i, &both_i],
    )?;

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut guard) = state.provider_menu_items.lock() {
            *guard = Some(crate::refresh::ProviderMenuItems {
                auto: auto_i.clone(),
                cursor: cursor_i.clone(),
                codex: codex_i.clone(),
                both: both_i.clone(),
            });
        }
    }

    let layout = current_layout_mode(app);
    let layout_standard_i = CheckMenuItem::with_id(
        app, "layout_standard", "标准", true, layout == "standard", None::<&str>,
    )?;
    let layout_minimal_i = CheckMenuItem::with_id(
        app, "layout_minimal", "极简", true, layout == "minimal", None::<&str>,
    )?;
    let layout_menu = Submenu::with_items(
        app,
        "显示",
        true,
        &[&layout_standard_i, &layout_minimal_i],
    )?;

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut guard) = state.layout_menu_items.lock() {
            *guard = Some(crate::refresh::LayoutMenuItems {
                standard: layout_standard_i.clone(),
                minimal: layout_minimal_i.clone(),
            });
        }
    }

    let font = current_font_size(app);
    let font_small_i =
        CheckMenuItem::with_id(app, "font_small", "小", true, font == "small", None::<&str>)?;
    let font_standard_i = CheckMenuItem::with_id(
        app, "font_standard", "标准", true, font == "standard", None::<&str>,
    )?;
    let font_large_i =
        CheckMenuItem::with_id(app, "font_large", "大", true, font == "large", None::<&str>)?;
    let font_xlarge_i = CheckMenuItem::with_id(
        app, "font_xlarge", "更大", true, font == "xlarge", None::<&str>,
    )?;
    let font_menu = Submenu::with_items(
        app,
        "字体大小",
        true,
        &[&font_small_i, &font_standard_i, &font_large_i, &font_xlarge_i],
    )?;

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(mut guard) = state.font_menu_items.lock() {
            *guard = Some(crate::refresh::FontMenuItems {
                small: font_small_i.clone(),
                standard: font_standard_i.clone(),
                large: font_large_i.clone(),
                xlarge: font_xlarge_i.clone(),
            });
        }
    }

    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &show_i,
            &hide_i,
            &refresh_i,
            &sep,
            &provider_menu,
            &layout_menu,
            &font_menu,
            &sep,
            &quit_i,
        ],
    )?;

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
            "prov_auto" => {
                let handle = app.clone();
                let _ = std::thread::spawn(move || {
                    let _ = set_provider_mode(&handle, "auto");
                });
            }
            "prov_cursor" => {
                let handle = app.clone();
                let _ = std::thread::spawn(move || {
                    let _ = set_provider_mode(&handle, "cursor");
                });
            }
            "prov_codex" => {
                let handle = app.clone();
                let _ = std::thread::spawn(move || {
                    let _ = set_provider_mode(&handle, "codex");
                });
            }
            "prov_both" => {
                let handle = app.clone();
                let _ = std::thread::spawn(move || {
                    let _ = set_provider_mode(&handle, "both");
                });
            }
            "layout_standard" | "layout_minimal" => {
                let mode = event.id.as_ref().trim_start_matches("layout_").to_string();
                let _ = set_layout_mode(app, &mode);
            }
            "font_small" | "font_standard" | "font_large" | "font_xlarge" => {
                let size = event.id.as_ref().trim_start_matches("font_").to_string();
                let _ = set_font_size(app, &size);
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
