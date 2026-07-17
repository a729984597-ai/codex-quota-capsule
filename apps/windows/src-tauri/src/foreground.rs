//! Foreground-window based provider detection (Windows only).
//!
//! Detection priority:
//! 1. The owning process's full executable path (authoritative):
//!    - file is ChatGPT.exe / codex.exe, or path contains "openai.codex" -> codex
//!    - file is Cursor.exe, or path contains "\cursor\" -> cursor
//! 2. Window title, but ONLY when the process is a terminal host (so a `codex`
//!    CLI running inside Windows Terminal / cmd / PowerShell is detected).
//!
//! Deliberately NOT matching a bare "\codex" substring in the path: this app
//! itself lives under `...\codex-quota-capsule\...`, and treating that as Codex
//! would flip auto-mode whenever the capsule (or Explorer in that folder)
//! briefly becomes foreground. Unrecognized windows keep the last choice.

#[cfg(windows)]
pub fn foreground_provider() -> Option<&'static str> {
    let (path, title) = foreground_info();

    if let Some(p) = path.as_deref() {
        let lower = p.to_ascii_lowercase();
        let file = lower.rsplit(['\\', '/']).next().unwrap_or(&lower);

        // Ignore our own process — path often contains "codex-quota-capsule".
        if is_self_process(file) {
            return None;
        }

        // Codex desktop app: `...\OpenAI.Codex_x.y.z\app\ChatGPT.exe`
        if file == "chatgpt.exe" || file == "codex.exe" || lower.contains("openai.codex") {
            return Some("codex");
        }
        // Cursor IDE
        if file == "cursor.exe" || lower.contains("\\cursor\\") || lower.contains("/cursor/") {
            return Some("cursor");
        }

        // Terminal host: fall back to the window title to spot a codex CLI.
        if is_terminal(file) {
            if let Some(t) = title.as_deref() {
                let tl = t.to_ascii_lowercase();
                if tl.contains("codex") {
                    return Some("codex");
                }
            }
        }
    }

    None
}

#[cfg(not(windows))]
pub fn foreground_provider() -> Option<&'static str> {
    None
}

#[cfg(windows)]
fn is_self_process(file: &str) -> bool {
    file.contains("quota capsule") || file.contains("quota-capsule")
}

#[cfg(windows)]
fn is_terminal(file: &str) -> bool {
    matches!(
        file,
        "windowsterminal.exe"
            | "wt.exe"
            | "cmd.exe"
            | "powershell.exe"
            | "pwsh.exe"
            | "conhost.exe"
            | "alacritty.exe"
            | "wezterm-gui.exe"
    )
}

#[cfg(windows)]
fn foreground_info() -> (Option<String>, Option<String>) {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return (None, None);
        }

        let mut title_buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32);
        let title = if len > 0 {
            Some(String::from_utf16_lossy(&title_buf[..len as usize]))
        } else {
            None
        };

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid == 0 {
            return (None, title);
        }
        let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return (None, title);
        }
        let mut buf = [0u16; 1024];
        let mut plen: u32 = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut plen);
        CloseHandle(handle);
        if ok == 0 || plen == 0 {
            return (None, title);
        }
        let full = String::from_utf16_lossy(&buf[..plen as usize]);
        (Some(full), title)
    }
}
