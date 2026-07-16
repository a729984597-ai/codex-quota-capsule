use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::model::{CapsuleViewModel, LastSuccessFile, RefreshPayload};
use crate::persist::{last_success_path, read_last_success, write_last_success};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const MAX_CONSECUTIVE_FAILURES: u32 = 5;
const STALE_MAX_AGE: Duration = Duration::from_secs(30 * 60);

pub struct AppState {
    pub view_model: Mutex<CapsuleViewModel>,
    pub consecutive_failures: Mutex<u32>,
    pub node_path: Mutex<Option<PathBuf>>,
    pub workspace_root: Mutex<PathBuf>,
    pub refresh_in_flight: AtomicBool,
    pub last_success_at: Mutex<Option<Instant>>,
}

impl AppState {
    pub fn new(workspace_root: PathBuf) -> Self {
        Self {
            view_model: Mutex::new(CapsuleViewModel::placeholder()),
            consecutive_failures: Mutex::new(0),
            node_path: Mutex::new(resolve_node_path()),
            workspace_root: Mutex::new(workspace_root),
            refresh_in_flight: AtomicBool::new(false),
            last_success_at: Mutex::new(None),
        }
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

    let live = spawn_refresh(&node, &script, None)?;
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
        spawn_refresh(&node, &script, Some(&stale_path)).ok()
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
    stale_from: Option<&Path>,
) -> Result<RefreshPayload, String> {
    let out_path = std::env::temp_dir().join(format!(
        "quota-capsule-refresh-{}.json",
        std::process::id()
    ));
    let mut cmd = Command::new(node);
    cmd.arg(script);
    if let Some(path) = stale_from {
        cmd.arg("--stale-from").arg(path);
    }
    cmd.arg("--out").arg(&out_path);
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
