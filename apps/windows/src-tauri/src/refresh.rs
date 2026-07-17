use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::model::{
    CapsuleViewModel, FontPreference, LastSuccessFile, ProviderPreference, RefreshPayload,
};
use crate::persist::{
    last_success_path, read_font_preference, read_last_success, read_provider_preference,
    write_font_preference, write_last_success, write_provider_preference,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const MAX_CONSECUTIVE_FAILURES: u32 = 5;
const STALE_MAX_AGE: Duration = Duration::from_secs(30 * 60);

pub struct AppState {
    pub view_model: Mutex<CapsuleViewModel>,
    pub consecutive_failures: Mutex<u32>,
    pub node_path: Mutex<Option<PathBuf>>,
    pub workspace_root: Mutex<PathBuf>,
    pub provider_mode: Mutex<String>,
    pub last_auto_provider: Mutex<String>,
    pub provider_menu_items: Mutex<Option<ProviderMenuItems>>,
    pub font_size: Mutex<String>,
    pub font_menu_items: Mutex<Option<FontMenuItems>>,
    pub refresh_in_flight: AtomicBool,
    pub last_success_at: Mutex<Option<Instant>>,
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

impl AppState {
    pub fn new(workspace_root: PathBuf) -> Self {
        let pref = read_provider_preference();
        let font = read_font_preference();
        Self {
            view_model: Mutex::new(CapsuleViewModel::placeholder()),
            consecutive_failures: Mutex::new(0),
            node_path: Mutex::new(resolve_node_path()),
            workspace_root: Mutex::new(workspace_root),
            provider_mode: Mutex::new(pref.mode),
            last_auto_provider: Mutex::new("codex".into()),
            provider_menu_items: Mutex::new(None),
            font_size: Mutex::new(font.size),
            font_menu_items: Mutex::new(None),
            refresh_in_flight: AtomicBool::new(false),
            last_success_at: Mutex::new(None),
        }
    }
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
    let _ = run_refresh(app);
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

/// Lightweight foreground poll for "auto" mode. When the focused app's
/// provider changes, update the remembered choice and trigger a refresh so
/// the capsule switches sources promptly instead of waiting for the 60s loop.
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
        let handle = app.clone();
        let _ = std::thread::spawn(move || {
            let _ = run_refresh(&handle);
        });
    }
}

pub fn resolve_node_path() -> Option<PathBuf> {
    if let Ok(output) = Command::new("where").arg("node").output() {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            if let Some(line) = text.lines().next() {
                let path = PathBuf::from(line.trim());
                if path.exists() {
                    return Some(path);
                }
            }
        }
    }
    let fallback = PathBuf::from(r"C:\Program Files\nodejs\node.exe");
    if fallback.exists() {
        Some(fallback)
    } else {
        None
    }
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
    let root = resolve_bridge_root(app);
    if let Ok(mut guard) = app.state::<AppState>().workspace_root.lock() {
        *guard = root;
    }
}

pub fn run_refresh(app: &AppHandle) -> Result<CapsuleViewModel, String> {
    let state = app.state::<AppState>();
    if state
        .refresh_in_flight
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Ok(state.view_model.lock().map_err(|e| e.to_string())?.clone());
    }

    let result = refresh_inner(app);
    state.refresh_in_flight.store(false, Ordering::SeqCst);
    result
}

fn refresh_inner(app: &AppHandle) -> Result<CapsuleViewModel, String> {
    let state = app.state::<AppState>();
    let node = state
        .node_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone();

    let Some(node) = node else {
        let vm = CapsuleViewModel::node_missing();
        publish(app, &state, vm.clone(), false)?;
        return Ok(vm);
    };

    let root = state
        .workspace_root
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
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
        publish(app, &state, vm.clone(), false)?;
        return Ok(vm);
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

    let live = spawn_refresh(&node, &script, &root, &effective_provider, None)?;
    if live.ok {
        let vm = live.view_model.clone();
        let _ = write_last_success(&LastSuccessFile {
            used_percent: vm.used_percent,
            fetched_at_iso: vm.fetched_at_iso.clone(),
            resets_at_iso: vm.resets_at_iso.clone(),
            view_model: vm.clone(),
        });
        publish(app, &state, vm.clone(), true)?;
        return Ok(vm);
    }

    // Failure path: try stale rebuild via bridge
    let stale_path = last_success_path();
    let stale_payload = if stale_path.exists() {
        spawn_refresh(&node, &script, &root, &effective_provider, Some(&stale_path)).ok()
    } else {
        None
    };

    let failures = {
        let mut n = state.consecutive_failures.lock().map_err(|e| e.to_string())?;
        *n += 1;
        *n
    };

    let stale_too_old = {
        let session_old = state
            .last_success_at
            .lock()
            .ok()
            .and_then(|g| *g)
            .map(|t| t.elapsed() > STALE_MAX_AGE);
        let file_old = std::fs::metadata(last_success_path())
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .map(|age| age > STALE_MAX_AGE);
        session_old.or(file_old).unwrap_or(true)
    };

    let escalate = failures >= MAX_CONSECUTIVE_FAILURES || stale_too_old;

    let vm = if escalate {
        let mut unavailable = live.view_model;
        unavailable.is_stale = false;
        if unavailable.diagnostic_code.is_none() {
            unavailable.diagnostic_code = live
                .snapshot_meta
                .as_ref()
                .and_then(|m| m.diagnostic_code.clone());
        }
        unavailable.judgment_text = "额度数据长时间不可用，已停止使用旧数据判断".into();
        unavailable
    } else if let Some(stale) = stale_payload {
        stale.view_model
    } else if let Some(saved) = read_last_success() {
        // Bridge stale path failed; keep last UI fields but mark unavailable
        let mut vm = saved.view_model;
        vm.state = "dataUnavailable".into();
        vm.tone = "unknown".into();
        vm.status_label = "数据暂不可用".into();
        vm.is_stale = true;
        vm.diagnostic_code = Some("stale".into());
        vm.judgment_text =
            "正在显示上次成功的周额度数据，恢复实时读取前暂不判断周速度。".into();
        vm
    } else {
        live.view_model
    };

    publish(app, &state, vm.clone(), false)?;
    Ok(vm)
}

fn spawn_refresh(
    node: &Path,
    script: &Path,
    bridge_root: &Path,
    provider_mode: &str,
    stale_from: Option<&Path>,
) -> Result<RefreshPayload, String> {
    let out_path = std::env::temp_dir().join(format!(
        "quota-capsule-refresh-{}.json",
        std::process::id()
    ));
    let mut cmd = Command::new(node);
    cmd.arg(script);
    cmd.arg("--provider").arg(provider_mode);
    if let Some(path) = stale_from {
        cmd.arg("--stale-from").arg(path);
    }
    cmd.arg("--out").arg(&out_path);
    // Node 22 built-in sqlite is still experimental; required for large Cursor DBs.
    cmd.env("NODE_OPTIONS", "--experimental-sqlite");
    cmd.current_dir(bridge_root);
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

fn publish(
    app: &AppHandle,
    state: &State<'_, AppState>,
    vm: CapsuleViewModel,
    success: bool,
) -> Result<(), String> {
    if success {
        *state
            .consecutive_failures
            .lock()
            .map_err(|e| e.to_string())? = 0;
        *state
            .last_success_at
            .lock()
            .map_err(|e| e.to_string())? = Some(Instant::now());
    }

    *state.view_model.lock().map_err(|e| e.to_string())? = vm.clone();

    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(vm.tooltip()));
    }

    app.emit("quota://updated", vm)
        .map_err(|e| e.to_string())?;
    Ok(())
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
