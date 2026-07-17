use std::fs;
use std::path::PathBuf;

use crate::model::{
    FontPreference, LastSuccessFile, LayoutPreference, ProviderPreference, WindowPosition,
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
