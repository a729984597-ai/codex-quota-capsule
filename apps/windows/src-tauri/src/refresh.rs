use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::model::{
    CapsuleViewModel, FontPreference, LastSuccessFile, LayoutPreference, ProviderOrderPreference,
    ProviderPreference, ProviderSlice, RefreshPayload, ThemePreference, WindowPosition,
};
use crate::persist::{
    last_success_path, read_font_preference, read_last_success, read_layout_preference,
    read_provider_order_preference, read_provider_preference, read_theme_preference,
    write_font_preference, write_last_success, write_layout_preference,
    write_provider_order_preference, write_provider_preference, write_theme_preference,
    write_window_position,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const MAX_CONSECUTIVE_FAILURES: u32 = 5;
/// Only reuse a provider snapshot for optimistic UI if fresher than this.
const OPTIMISTIC_CACHE_MAX_AGE: Duration = Duration::from_secs(10 * 60);

#[derive(Clone)]
pub(crate) struct CachedProviderVm {
    vm: CapsuleViewModel,
    cached_at: Instant,
}

pub struct AppState {
    pub view_model: Mutex<CapsuleViewModel>,
    pub consecutive_failures: Mutex<u32>,
    pub node_path: Mutex<Option<PathBuf>>,
    pub workspace_root: Mutex<PathBuf>,
    pub provider_mode: Mutex<String>,
    pub last_auto_provider: Mutex<String>,
    pub provider_menu_items: Mutex<Option<ProviderMenuItems>>,
    /// Last successful single-provider snapshots for optimistic auto-switch.
    pub provider_cache: Mutex<HashMap<String, CachedProviderVm>>,
    pub font_size: Mutex<String>,
    pub font_menu_items: Mutex<Option<FontMenuItems>>,
    pub layout_mode: Mutex<String>,
    pub layout_menu_items: Mutex<Option<LayoutMenuItems>>,
    pub theme_mode: Mutex<String>,
    pub theme_menu_items: Mutex<Option<ThemeMenuItems>>,
    pub provider_order: Mutex<String>,
    pub provider_order_menu_items: Mutex<Option<ProviderOrderMenuItems>>,
    pub refresh_in_flight: AtomicBool,
    pub refresh_pending: AtomicBool,
    pub last_success_at: Mutex<Option<Instant>>,
    /// Skip persisting Moved events during expand/collapse programmatic moves.
    pub suppress_position_save: AtomicBool,
    /// While native context menu is open, do not re-assert HWND_TOPMOST
    /// (that would cover the menu after focus loss).
    pub context_menu_open: AtomicBool,
}

#[derive(Clone)]
pub struct ProviderMenuItems {
    pub auto: tauri::menu::CheckMenuItem<tauri::Wry>,
    pub cursor: tauri::menu::CheckMenuItem<tauri::Wry>,
    pub codex: tauri::menu::CheckMenuItem<tauri::Wry>,
    pub both: tauri::menu::CheckMenuItem<tauri::Wry>,
}

impl ProviderMenuItems {
    pub fn set_checked(&self, mode: &str) {
        let _ = self.auto.set_checked(mode == "auto");
        let _ = self.cursor.set_checked(mode == "cursor");
        let _ = self.codex.set_checked(mode == "codex");
        let _ = self.both.set_checked(mode == "both");
    }
}

#[derive(Clone)]
pub struct FontMenuItems {
    pub small: tauri::menu::CheckMenuItem<tauri::Wry>,
    pub standard: tauri::menu::CheckMenuItem<tauri::Wry>,
    pub large: tauri::menu::CheckMenuItem<tauri::Wry>,
    pub xlarge: tauri::menu::CheckMenuItem<tauri::Wry>,
}

impl FontMenuItems {
    pub fn set_checked(&self, size: &str) {
        let _ = self.small.set_checked(size == "small");
        let _ = self.standard.set_checked(size == "standard");
        let _ = self.large.set_checked(size == "large");
        let _ = self.xlarge.set_checked(size == "xlarge");
    }
}

#[derive(Clone)]
pub struct LayoutMenuItems {
    pub standard: tauri::menu::CheckMenuItem<tauri::Wry>,
    pub minimal: tauri::menu::CheckMenuItem<tauri::Wry>,
}

impl LayoutMenuItems {
    pub fn set_checked(&self, mode: &str) {
        let _ = self.standard.set_checked(mode == "standard");
        let _ = self.minimal.set_checked(mode == "minimal");
    }
}

#[derive(Clone)]
pub struct ThemeMenuItems {
    pub dark: tauri::menu::CheckMenuItem<tauri::Wry>,
    pub light: tauri::menu::CheckMenuItem<tauri::Wry>,
}

impl ThemeMenuItems {
    pub fn set_checked(&self, mode: &str) {
        let _ = self.dark.set_checked(mode == "dark");
        let _ = self.light.set_checked(mode == "light");
    }
}

#[derive(Clone)]
pub struct ProviderOrderMenuItems {
    pub cursor_first: tauri::menu::CheckMenuItem<tauri::Wry>,
    pub codex_first: tauri::menu::CheckMenuItem<tauri::Wry>,
}

impl ProviderOrderMenuItems {
    pub fn set_checked(&self, order: &str) {
        let _ = self.cursor_first.set_checked(order == "cursor-first");
        let _ = self.codex_first.set_checked(order == "codex-first");
    }
}

impl AppState {
    pub fn new(workspace_root: PathBuf) -> Self {
        let pref = read_provider_preference();
        let font = read_font_preference();
        let layout = read_layout_preference();
        let theme = read_theme_preference();
        let order = read_provider_order_preference();
        let mut provider_cache = HashMap::new();
        if let Some(saved) = read_last_success() {
            // Approximate cache age from last-success file mtime; unknown → stale.
            let cached_at = cache_instant_from_file(&last_success_path());
            remember_provider_vm(&mut provider_cache, &saved.view_model, cached_at);
        }
        Self {
            view_model: Mutex::new(CapsuleViewModel::placeholder()),
            consecutive_failures: Mutex::new(0),
            node_path: Mutex::new(resolve_node_path()),
            workspace_root: Mutex::new(workspace_root),
            provider_mode: Mutex::new(pref.mode),
            last_auto_provider: Mutex::new("codex".into()),
            provider_menu_items: Mutex::new(None),
            provider_cache: Mutex::new(provider_cache),
            font_size: Mutex::new(font.size),
            font_menu_items: Mutex::new(None),
            layout_mode: Mutex::new(layout.mode),
            layout_menu_items: Mutex::new(None),
            theme_mode: Mutex::new(theme.mode),
            theme_menu_items: Mutex::new(None),
            provider_order: Mutex::new(order.order),
            provider_order_menu_items: Mutex::new(None),
            refresh_in_flight: AtomicBool::new(false),
            refresh_pending: AtomicBool::new(false),
            last_success_at: Mutex::new(None),
            suppress_position_save: AtomicBool::new(false),
            context_menu_open: AtomicBool::new(false),
        }
    }
}

#[tauri::command]
pub fn suppress_window_position_save(app: AppHandle, suppress: bool) {
    app.state::<AppState>()
        .suppress_position_save
        .store(suppress, Ordering::SeqCst);
}

#[tauri::command]
pub fn save_window_position(x: f64, y: f64) -> Result<(), String> {
    write_window_position(&WindowPosition { x, y })
}

pub fn set_provider_mode(app: &AppHandle, mode: &str) -> Result<(), String> {
    let normalized = match mode {
        "auto" | "cursor" | "codex" | "both" => mode,
        _ => return Err(format!("unsupported provider mode: {mode}")),
    };
    write_provider_preference(&ProviderPreference {
        mode: normalized.into(),
    })?;
    {
        let state = app.state::<AppState>();
        *state.provider_mode.lock().map_err(|e| e.to_string())? = normalized.into();
        let items_opt = state
            .provider_menu_items
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        if let Some(items) = items_opt {
            items.set_checked(normalized);
        }
    }
    // Optimistic UI for forced single-provider switch, then live refresh.
    if normalized == "cursor" || normalized == "codex" {
        publish_optimistic_provider(app, normalized);
    }
    // Refresh now; if another refresh is mid-flight with the old mode, the
    // pending-retry in run_refresh + this deferred pass pick up "both"/etc.
    let _ = run_refresh(app);
    let handle = app.clone();
    let _ = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(400));
        let _ = run_refresh(&handle);
    });
    Ok(())
}

pub fn current_provider_mode(app: &AppHandle) -> String {
    app.state::<AppState>()
        .provider_mode
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "auto".into())
}

pub fn set_font_size(app: &AppHandle, size: &str) -> Result<(), String> {
    let normalized = match size {
        "small" | "standard" | "large" | "xlarge" => size,
        _ => return Err(format!("unsupported font size: {size}")),
    };
    write_font_preference(&FontPreference {
        size: normalized.into(),
    })?;
    {
        let state = app.state::<AppState>();
        *state.font_size.lock().map_err(|e| e.to_string())? = normalized.into();
        let items_opt = state
            .font_menu_items
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        if let Some(items) = items_opt {
            items.set_checked(normalized);
        }
    }
    let _ = app.emit("quota://font-changed", normalized.to_string());
    Ok(())
}

pub fn current_font_size(app: &AppHandle) -> String {
    app.state::<AppState>()
        .font_size
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "standard".into())
}

#[tauri::command]
pub fn get_font_size(app: AppHandle) -> String {
    current_font_size(&app)
}

pub fn set_layout_mode(app: &AppHandle, mode: &str) -> Result<(), String> {
    let normalized = match mode {
        "standard" | "minimal" => mode,
        _ => return Err(format!("unsupported layout mode: {mode}")),
    };
    write_layout_preference(&LayoutPreference {
        mode: normalized.into(),
    })?;
    {
        let state = app.state::<AppState>();
        *state.layout_mode.lock().map_err(|e| e.to_string())? = normalized.into();
        let items_opt = state
            .layout_menu_items
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        if let Some(items) = items_opt {
            items.set_checked(normalized);
        }
    }
    let _ = app.emit("quota://layout-changed", normalized.to_string());
    Ok(())
}

pub fn current_layout_mode(app: &AppHandle) -> String {
    app.state::<AppState>()
        .layout_mode
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "standard".into())
}

#[tauri::command]
pub fn get_layout_mode(app: AppHandle) -> String {
    current_layout_mode(&app)
}

pub fn set_theme_mode(app: &AppHandle, mode: &str) -> Result<(), String> {
    let normalized = match mode {
        "dark" | "light" => mode,
        _ => return Err(format!("unsupported theme mode: {mode}")),
    };
    write_theme_preference(&ThemePreference {
        mode: normalized.into(),
    })?;
    {
        let state = app.state::<AppState>();
        *state.theme_mode.lock().map_err(|e| e.to_string())? = normalized.into();
        let items_opt = state
            .theme_menu_items
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        if let Some(items) = items_opt {
            items.set_checked(normalized);
        }
    }
    let _ = app.emit("quota://theme-changed", normalized.to_string());
    Ok(())
}

pub fn current_theme_mode(app: &AppHandle) -> String {
    app.state::<AppState>()
        .theme_mode
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "dark".into())
}

#[tauri::command]
pub fn get_theme_mode(app: AppHandle) -> String {
    current_theme_mode(&app)
}

pub fn set_provider_order(app: &AppHandle, order: &str) -> Result<(), String> {
    let normalized = match order {
        "cursor-first" | "codex-first" => order,
        _ => return Err(format!("unsupported provider order: {order}")),
    };
    write_provider_order_preference(&ProviderOrderPreference {
        order: normalized.into(),
    })?;
    {
        let state = app.state::<AppState>();
        *state.provider_order.lock().map_err(|e| e.to_string())? = normalized.into();
        let items_opt = state
            .provider_order_menu_items
            .lock()
            .map_err(|e| e.to_string())?
            .clone();
        if let Some(items) = items_opt {
            items.set_checked(normalized);
        }
        let mut vm = state.view_model.lock().map_err(|e| e.to_string())?.clone();
        vm.apply_provider_order(normalized);
        *state.view_model.lock().map_err(|e| e.to_string())? = vm.clone();
        if let Some(tray) = app.tray_by_id("main") {
            let _ = tray.set_tooltip(Some(vm.tooltip()));
        }
        app.emit("quota://updated", vm)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn current_provider_order(app: &AppHandle) -> String {
    app.state::<AppState>()
        .provider_order
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "cursor-first".into())
}

#[tauri::command]
pub fn get_provider_order(app: AppHandle) -> String {
    current_provider_order(&app)
}

/// Lightweight foreground poll for "auto" mode. When the focused app's
/// provider changes, flip the capsule to cached numbers immediately, then
/// refresh in the background so the label doesn't wait on network I/O.
pub fn poll_auto_switch(app: &AppHandle) {
    let state = app.state::<AppState>();
    let mode = match state.provider_mode.lock() {
        Ok(g) => g.clone(),
        Err(_) => return,
    };
    if mode != "auto" {
        return;
    }
    let detected = crate::foreground::foreground_provider();
    let next = match detected {
        Some(p) => p.to_string(),
        None => return,
    };
    let changed = match state.last_auto_provider.lock() {
        Ok(mut g) => {
            if *g == next {
                false
            } else {
                *g = next.clone();
                true
            }
        }
        Err(_) => return,
    };
    if changed {
        publish_optimistic_provider(app, &next);
        let handle = app.clone();
        let _ = std::thread::spawn(move || {
            let _ = run_refresh(&handle);
        });
    }
}

pub fn resolve_node_path() -> Option<PathBuf> {
    resolve_node_path_near(None)
}

/// Prefer the Node runtime bundled next to the bridge (`runtime/node/node.exe`),
/// then fall back to a system install.
pub fn resolve_node_path_near(bridge_root: Option<&Path>) -> Option<PathBuf> {
    if let Some(root) = bridge_root {
        let bundled = root.join("runtime").join("node").join("node.exe");
        if bundled.is_file() {
            return Some(bundled);
        }
    }

    // 1) Current process PATH via `where`
    if let Some(p) = node_from_where() {
        return Some(p);
    }

    // 2) Well-known install locations (GUI apps often miss a freshly updated PATH)
    for candidate in known_node_candidates() {
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    // 3) Merge Machine+User PATH from the environment registry, then look again
    if let Some(p) = node_from_refreshed_path() {
        return Some(p);
    }

    None
}

fn node_from_where() -> Option<PathBuf> {
    let output = Command::new("where").arg("node").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().next()?.trim();
    if line.is_empty() {
        return None;
    }
    let path = PathBuf::from(line);
    path.is_file().then_some(path)
}

fn known_node_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    out.push(PathBuf::from(r"C:\Program Files\nodejs\node.exe"));
    out.push(PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"));
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        out.push(PathBuf::from(&local).join(r"Programs\node\node.exe"));
    }
    if let Ok(user) = std::env::var("USERPROFILE") {
        out.push(PathBuf::from(&user).join(r"scoop\apps\nodejs\current\node.exe"));
        out.push(PathBuf::from(&user).join(r"scoop\apps\nodejs-lts\current\node.exe"));
        // nvm-windows: %APPDATA%\nvm\<version>\node.exe — probe symlink/current if present
        if let Ok(appdata) = std::env::var("APPDATA") {
            let nvm = PathBuf::from(appdata).join("nvm");
            out.push(nvm.join("nodejs").join("node.exe"));
            if let Ok(entries) = std::fs::read_dir(&nvm) {
                for entry in entries.flatten() {
                    let p = entry.path().join("node.exe");
                    if p.is_file() {
                        out.push(p);
                    }
                }
            }
        }
    }
    out
}

fn node_from_refreshed_path() -> Option<PathBuf> {
    // Pull Machine+User PATH (not the stale PATH inherited by a desktop-launched exe).
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "$m=[Environment]::GetEnvironmentVariable('Path','Machine');$u=[Environment]::GetEnvironmentVariable('Path','User');$env:Path=\"$m;$u\";(Get-Command node -ErrorAction SilentlyContinue).Source",
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let line = text.lines().map(str::trim).find(|l| !l.is_empty())?;
    let path = PathBuf::from(line);
    path.is_file().then_some(path)
}

fn script_path(root: &Path) -> PathBuf {
    root.join("scripts").join("refresh-once.mjs")
}

fn is_bridge_root(dir: &Path) -> bool {
    script_path(dir).exists()
        && dir
            .join("packages")
            .join("core")
            .join("dist")
            .join("index.js")
            .exists()
}

/// Prefer bundled resources next to the packaged .exe; fall back to repo / env.
pub fn resolve_bridge_root(app: &AppHandle) -> PathBuf {
    if let Ok(resource_dir) = app.path().resource_dir() {
        // Tauri may place files as $RESOURCE/resources/... or $RESOURCE/...
        for candidate in [
            resource_dir.join("resources"),
            resource_dir.clone(),
        ] {
            if is_bridge_root(&candidate) {
                return candidate;
            }
        }
    }
    detect_workspace_root()
}

pub fn apply_bridge_root(app: &AppHandle) {
    let root = path_for_external_process(&resolve_bridge_root(app));
    if let Ok(mut guard) = app.state::<AppState>().workspace_root.lock() {
        *guard = root;
    }
}

pub fn run_refresh(app: &AppHandle) -> Result<CapsuleViewModel, String> {
    let state = app.state::<AppState>();
    // If a refresh is already running, ask it to run once more afterward so a
    // mid-flight provider switch (e.g. 都显示) is not lost.
    if state
        .refresh_in_flight
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        state.refresh_pending.store(true, Ordering::SeqCst);
        return Ok(state.view_model.lock().map_err(|e| e.to_string())?.clone());
    }

    let mut result = refresh_inner(app);
    while state.refresh_pending.swap(false, Ordering::SeqCst) {
        result = refresh_inner(app);
    }
    state.refresh_in_flight.store(false, Ordering::SeqCst);

    // Another caller may have set pending after we cleared in_flight but before
    // we returned — kick one more pass so the latest mode always wins.
    if state.refresh_pending.swap(false, Ordering::SeqCst) {
        return run_refresh(app);
    }
    result
}

fn refresh_inner(app: &AppHandle) -> Result<CapsuleViewModel, String> {
    let state = app.state::<AppState>();
    // Prefer bundled Node beside the bridge; re-probe when missing so a mid-session
    // install (or late bridge-root apply) can recover after「立即刷新」.
    let root = state
        .workspace_root
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    let node = {
        let mut guard = state.node_path.lock().map_err(|e| e.to_string())?;
        let bundled = root.join("runtime").join("node").join("node.exe");
        if bundled.is_file() {
            *guard = Some(bundled.clone());
            Some(bundled)
        } else if guard.is_none() {
            let found = resolve_node_path_near(Some(&root));
            *guard = found.clone();
            found
        } else {
            guard.clone()
        }
    };

    let Some(node) = node else {
        let mode = state
            .provider_mode
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "auto".into());
        let label = match mode.as_str() {
            "cursor" => "cursor",
            "both" => "both",
            _ => "codex",
        };
        let vm = CapsuleViewModel::node_missing(label);
        return publish(app, &state, vm, false);
    };

    let script = script_path(&root);
    if !script.exists() {
        let mut vm = CapsuleViewModel::placeholder();
        vm.state = "dataUnavailable".into();
        vm.tone = "unknown".into();
        vm.status_label = "数据暂不可用".into();
        vm.diagnostic_code = Some("parse_error".into());
        vm.judgment_text = format!(
            "刷新桥接脚本缺失：{}。请重新安装应用，或设置 QUOTA_CAPSULE_ROOT 指向仓库根目录。",
            script.display()
        );
        return publish(app, &state, vm, false);
    }

    let provider_mode = state
        .provider_mode
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    // Resolve "auto" by foreground window; keep last choice when undecided.
    let effective_provider = if provider_mode == "auto" {
        let resolved = crate::foreground::foreground_provider();
        let next = match resolved {
            Some(p) => p.to_string(),
            None => state
                .last_auto_provider
                .lock()
                .map_err(|e| e.to_string())?
                .clone(),
        };
        *state
            .last_auto_provider
            .lock()
            .map_err(|e| e.to_string())? = next.clone();
        next
    } else {
        provider_mode.clone()
    };

    let cache_path = last_success_path();
    let cached = cache_path.exists().then_some(cache_path.as_path());
    let live = spawn_refresh(&node, &script, &root, &effective_provider, cached)?;
    if live.ok {
        let vm = live.view_model.clone();
        let _ = write_last_success(&LastSuccessFile {
            used_percent: vm.used_percent,
            fetched_at_iso: vm.fetched_at_iso.clone(),
            resets_at_iso: vm.resets_at_iso.clone(),
            view_model: vm.clone(),
        });
        return publish(app, &state, vm, true);
    }

    let failures = {
        let mut count = state
            .consecutive_failures
            .lock()
            .map_err(|e| e.to_string())?;
        *count += 1;
        *count
    };

    let mut vm = if failures >= MAX_CONSECUTIVE_FAILURES && live.view_model.has_stale_data() {
        spawn_refresh(&node, &script, &root, &effective_provider, None)
            .map(|payload| payload.view_model)?
    } else {
        live.view_model
    };

    if failures >= MAX_CONSECUTIVE_FAILURES {
        vm.is_stale = false;
        vm.judgment_text = "额度数据长时间不可用，已停止使用旧数据判断".into();
    }

    publish(app, &state, vm, false)
}

fn spawn_refresh(
    node: &Path,
    script: &Path,
    bridge_root: &Path,
    provider_mode: &str,
    stale_from: Option<&Path>,
) -> Result<RefreshPayload, String> {
    // Node 22 on Windows mishandles Win32 extended paths (`\\?\C:\...`),
    // producing EISDIR on `lstat('C:')`. Always pass verbatim DOS paths.
    let node = path_for_external_process(node);
    let script = path_for_external_process(script);
    let bridge_root = path_for_external_process(bridge_root);
    let out_path = path_for_external_process(&std::env::temp_dir().join(format!(
        "quota-capsule-refresh-{}.json",
        std::process::id()
    )));

    let mut cmd = Command::new(&node);
    cmd.arg(&script);
    cmd.arg("--provider").arg(provider_mode);
    if let Some(path) = stale_from {
        cmd.arg("--stale-from").arg(path_for_external_process(path));
    }
    cmd.arg("--out").arg(&out_path);
    // Node 22 built-in sqlite is still experimental; required for large Cursor DBs.
    cmd.env("NODE_OPTIONS", "--experimental-sqlite");
    cmd.current_dir(&bridge_root);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd.output().map_err(|e| e.to_string())?;
    if !out_path.exists() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "refresh-once did not write output file (status={:?}): {}",
            output.status.code(),
            stderr.chars().take(300).collect::<String>()
        ));
    }
    let raw = std::fs::read_to_string(&out_path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&out_path);
    serde_json::from_str::<RefreshPayload>(&raw).map_err(|e| {
        format!(
            "failed to parse refresh JSON: {e}; body={}",
            raw.chars().take(300).collect::<String>()
        )
    })
}

/// Strip Windows `\\?\` / `\\?\UNC\` prefixes so child processes (esp. Node 22)
/// receive normal paths.
fn path_for_external_process(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let raw = path.to_string_lossy();
        if let Some(rest) = raw.strip_prefix(r"\\?\") {
            if let Some(unc) = rest.strip_prefix(r"UNC\") {
                return PathBuf::from(format!(r"\\{unc}"));
            }
            return PathBuf::from(rest);
        }
        path.to_path_buf()
    }
    #[cfg(not(windows))]
    {
        path.to_path_buf()
    }
}

fn publish(
    app: &AppHandle,
    state: &State<'_, AppState>,
    mut vm: CapsuleViewModel,
    success: bool,
) -> Result<CapsuleViewModel, String> {
    if success {
        *state
            .consecutive_failures
            .lock()
            .map_err(|e| e.to_string())? = 0;
        *state
            .last_success_at
            .lock()
            .map_err(|e| e.to_string())? = Some(Instant::now());
        if let Ok(mut cache) = state.provider_cache.lock() {
            remember_provider_vm(&mut cache, &vm, Instant::now());
        }
    }

    let order = state
        .provider_order
        .lock()
        .map(|g| g.clone())
        .unwrap_or_else(|_| "cursor-first".into());
    vm.apply_provider_order(&order);

    *state.view_model.lock().map_err(|e| e.to_string())? = vm.clone();

    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(vm.tooltip()));
    }

    app.emit("quota://updated", vm.clone())
        .map_err(|e| e.to_string())?;
    Ok(vm)
}

fn remember_provider_vm(
    cache: &mut HashMap<String, CachedProviderVm>,
    vm: &CapsuleViewModel,
    cached_at: Instant,
) {
    if let Some(providers) = &vm.providers {
        for slice in providers {
            if slice.provider == "cursor" || slice.provider == "codex" {
                cache.insert(
                    slice.provider.clone(),
                    CachedProviderVm {
                        vm: vm_from_slice(slice),
                        cached_at,
                    },
                );
            }
        }
        return;
    }
    if vm.provider == "cursor" || vm.provider == "codex" {
        let mut single = vm.clone();
        single.display_mode = "single".into();
        single.providers = None;
        cache.insert(
            vm.provider.clone(),
            CachedProviderVm {
                vm: single,
                cached_at,
            },
        );
    }
}

fn vm_from_slice(slice: &ProviderSlice) -> CapsuleViewModel {
    CapsuleViewModel {
        provider: slice.provider.clone(),
        display_mode: "single".into(),
        state: slice.state.clone(),
        tone: slice.tone.clone(),
        status_label: slice.status_label.clone(),
        judgment_text: slice.judgment_text.clone(),
        used_percent: slice.used_percent,
        usage_breakdown: slice.usage_breakdown.clone(),
        reset_countdown_text: slice.reset_countdown_text.clone(),
        freshness_text: slice.freshness_text.clone(),
        is_stale: slice.is_stale,
        diagnostic_code: slice.diagnostic_code.clone(),
        fetched_at_iso: slice.fetched_at_iso.clone(),
        resets_at_iso: slice.resets_at_iso.clone(),
        providers: None,
    }
}

fn switching_placeholder(provider: &str) -> CapsuleViewModel {
    let mut vm = CapsuleViewModel::placeholder();
    vm.provider = provider.into();
    vm.display_mode = "single".into();
    vm.status_label = "刷新中".into();
    vm.judgment_text = "正在读取额度…".into();
    vm.freshness_text = "刷新中…".into();
    vm
}

fn cache_instant_from_file(path: &Path) -> Instant {
    let age = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok());
    match age {
        Some(age) => Instant::now()
            .checked_sub(age)
            .unwrap_or_else(Instant::now),
        // Unknown age → treat as already expired for optimistic reuse.
        None => Instant::now()
            .checked_sub(OPTIMISTIC_CACHE_MAX_AGE + Duration::from_secs(1))
            .unwrap_or_else(Instant::now),
    }
}

/// Show the last known numbers for `provider` immediately when the cache is
/// fresher than OPTIMISTIC_CACHE_MAX_AGE; otherwise a lightweight placeholder.
fn publish_optimistic_provider(app: &AppHandle, provider: &str) {
    let state = app.state::<AppState>();
    let cached = state
        .provider_cache
        .lock()
        .ok()
        .and_then(|g| g.get(provider).cloned());
    let vm = match cached {
        Some(entry) if entry.cached_at.elapsed() <= OPTIMISTIC_CACHE_MAX_AGE => {
            let mut vm = entry.vm;
            vm.provider = provider.into();
            vm.display_mode = "single".into();
            vm.providers = None;
            vm.is_stale = true;
            vm.freshness_text = "缓存 · 刷新中…".into();
            vm
        }
        _ => switching_placeholder(provider),
    };
    let _ = publish(app, &state, vm, false);
}

#[tauri::command]
pub fn refresh_now(app: AppHandle) -> Result<CapsuleViewModel, String> {
    run_refresh(&app)
}

#[tauri::command]
pub fn get_view_model(state: State<'_, AppState>) -> Result<CapsuleViewModel, String> {
    Ok(state.view_model.lock().map_err(|e| e.to_string())?.clone())
}

pub fn detect_workspace_root() -> PathBuf {
    if let Ok(root) = std::env::var("QUOTA_CAPSULE_ROOT") {
        return PathBuf::from(root);
    }
    // Dev: .../apps/windows/src-tauri -> repo root
    let exe = std::env::current_exe().unwrap_or_default();
    let mut dir = exe
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    for _ in 0..8 {
        if dir.join("scripts").join("refresh-once.mjs").exists()
            && dir.join("packages").join("core").exists()
        {
            return dir;
        }
        if !dir.pop() {
            break;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}
