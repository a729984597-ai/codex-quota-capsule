//! Foreground-window based provider detection (Windows only).
//!
//! Detection priority:
//! 1. The owning process's full executable path (authoritative):
//!    - path contains "openai.codex" / "\codex", or file is ChatGPT.exe -> codex
//!      (the Codex desktop app ships as `...\OpenAI.Codex_x.y.z\app\ChatGPT.exe`
//!      and recent builds are branded "ChatGPT")
//!    - path contains "cursor" -> cursor
//! 2. Window title, but ONLY when the process is a terminal host (so a `codex`
//!    CLI running inside Windows Terminal / cmd / PowerShell is detected).
//!    Title is intentionally NOT used for GUI apps, because a Cursor window
//!    editing a folder named e.g. "codex-quota-capsule" would otherwise be
//!    misclassified as Codex.

#[cfg(windows)]
pub fn foreground_provider() -> Option<&'static str> {
    let (path, title) = foreground_info();

    if let Some(p) = path.as_deref() {
        let lower = p.to_ascii_lowercase();
        let file = lower.rsplit(['\\', '/']).next().unwrap_or(&lower);

        // Codex desktop app: package path is `...\OpenAI.Codex_x.y.z\app\ChatGPT.exe`.
        // Recent builds renamed the executable to ChatGPT.exe, so match either
        // the install path or the file name.
        if lower.contains("openai.codex")
            || lower.contains("\\codex")
            || file == "chatgpt.exe"
        {
            return Some("codex");
        }
        if lower.contains("cursor") {
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
