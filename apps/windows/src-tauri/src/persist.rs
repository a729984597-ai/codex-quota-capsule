use std::fs;
use std::path::PathBuf;

use crate::model::{
    FontPreference, LastSuccessFile, LayoutPreference, ProviderOrderPreference, ProviderPreference,
    ThemePreference, WindowPosition,
};

fn strip_bom(raw: &str) -> &str {
    raw.strip_prefix('\u{feff}').unwrap_or(raw)
}

pub fn app_data_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Quota Capsule Beta")
}

pub fn ensure_app_data_dir() -> std::io::Result<PathBuf> {
    let dir = app_data_dir();
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn last_success_path() -> PathBuf {
    app_data_dir().join("last-success.json")
}

pub fn window_position_path() -> PathBuf {
    app_data_dir().join("window-position.json")
}

pub fn write_last_success(file: &LastSuccessFile) -> Result<(), String> {
    let dir = ensure_app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("last-success.json");
    let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn read_last_success() -> Option<LastSuccessFile> {
    let path = last_success_path();
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(strip_bom(&raw)).ok()
}

pub fn write_window_position(pos: &WindowPosition) -> Result<(), String> {
    let dir = ensure_app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("window-position.json");
    let json = serde_json::to_string_pretty(pos).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn read_window_position() -> Option<WindowPosition> {
    let path = window_position_path();
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(strip_bom(&raw)).ok()
}

pub fn provider_preference_path() -> PathBuf {
    app_data_dir().join("provider-preference.json")
}

pub fn write_provider_preference(pref: &ProviderPreference) -> Result<(), String> {
    let dir = ensure_app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("provider-preference.json");
    let json = serde_json::to_string_pretty(pref).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn read_provider_preference() -> ProviderPreference {
    let path = provider_preference_path();
    let raw = match fs::read_to_string(path) {
        Ok(v) => v,
        Err(_) => return ProviderPreference::default(),
    };
    serde_json::from_str(strip_bom(&raw)).unwrap_or_default()
}

pub fn font_preference_path() -> PathBuf {
    app_data_dir().join("font-preference.json")
}

pub fn write_font_preference(pref: &FontPreference) -> Result<(), String> {
    let dir = ensure_app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("font-preference.json");
    let json = serde_json::to_string_pretty(pref).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn read_font_preference() -> FontPreference {
    let path = font_preference_path();
    let raw = match fs::read_to_string(path) {
        Ok(v) => v,
        Err(_) => return FontPreference::default(),
    };
    serde_json::from_str(strip_bom(&raw)).unwrap_or_default()
}

pub fn layout_preference_path() -> PathBuf {
    app_data_dir().join("layout-preference.json")
}

pub fn write_layout_preference(pref: &LayoutPreference) -> Result<(), String> {
    let dir = ensure_app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("layout-preference.json");
    let json = serde_json::to_string_pretty(pref).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn read_layout_preference() -> LayoutPreference {
    let path = layout_preference_path();
    let raw = match fs::read_to_string(path) {
        Ok(v) => v,
        Err(_) => return LayoutPreference::default(),
    };
    serde_json::from_str(strip_bom(&raw)).unwrap_or_default()
}

pub fn theme_preference_path() -> PathBuf {
    app_data_dir().join("theme-preference.json")
}

pub fn write_theme_preference(pref: &ThemePreference) -> Result<(), String> {
    let dir = ensure_app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("theme-preference.json");
    let json = serde_json::to_string_pretty(pref).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn read_theme_preference() -> ThemePreference {
    let path = theme_preference_path();
    let raw = match fs::read_to_string(path) {
        Ok(v) => v,
        Err(_) => return ThemePreference::default(),
    };
    serde_json::from_str(strip_bom(&raw)).unwrap_or_default()
}

pub fn provider_order_preference_path() -> PathBuf {
    app_data_dir().join("provider-order-preference.json")
}

pub fn write_provider_order_preference(pref: &ProviderOrderPreference) -> Result<(), String> {
    let dir = ensure_app_data_dir().map_err(|e| e.to_string())?;
    let path = dir.join("provider-order-preference.json");
    let json = serde_json::to_string_pretty(pref).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn read_provider_order_preference() -> ProviderOrderPreference {
    let path = provider_order_preference_path();
    let raw = match fs::read_to_string(path) {
        Ok(v) => v,
        Err(_) => return ProviderOrderPreference::default(),
    };
    serde_json::from_str(strip_bom(&raw)).unwrap_or_default()
}

/// Append a line to the local diagnostic log (best-effort, never panics).
pub fn append_diagnostic_log(line: &str) {
    let Ok(dir) = ensure_app_data_dir() else {
        return;
    };
    let path = dir.join("diagnostic.log");
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let entry = format!("[unix:{ts}] {line}\n");
    let _ = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut f| {
            use std::io::Write;
            f.write_all(entry.as_bytes())
        });
}

/// Capture Rust panics to diagnostic.log before the process aborts.
pub fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let name = thread.name().unwrap_or("<unnamed>");
        let payload = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "non-string panic payload".into()
        };
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "<unknown>".into());
        append_diagnostic_log(&format!(
            "PANIC thread={name} at {location} :: {payload}"
        ));
        default(info);
    }));
}
