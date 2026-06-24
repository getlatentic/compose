//! Start the local Ollama runtime. Readiness is an HTTP reachability probe in
//! the harness; this launches the app so a "not running" state is one click to
//! fix instead of a dead end.

/// Launch the installed Ollama app, which brings up its local server. `open -a`
/// is the standard macOS app launch — no privilege escalation, the same as the
/// user double-clicking it. A non-zero exit means Ollama isn't installed, which
/// we surface as a friendly, actionable error.
#[tauri::command(async)]
pub fn ollama_start() -> Result<(), String> {
    let status = std::process::Command::new("open")
        .args(["-a", "Ollama"])
        .status()
        .map_err(|error| format!("Couldn't launch Ollama: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Ollama doesn't seem to be installed — get it from ollama.com.".to_owned())
    }
}

/// Whether the Ollama app is installed — the menu-bar app `ollama_start` launches.
/// A filesystem check (no process spawn), so the first-run resolver can tell
/// "installed but stopped" (→ start it) from "not installed" (→ nudge to
/// download). The HTTP readiness probe can't: a stopped server and a missing one
/// both fail it identically.
#[tauri::command(async)]
pub fn ollama_installed() -> bool {
    use std::path::Path;
    if Path::new("/Applications/Ollama.app").exists() {
        return true;
    }
    std::env::var_os("HOME")
        .map(|home| Path::new(&home).join("Applications/Ollama.app").exists())
        .unwrap_or(false)
}
