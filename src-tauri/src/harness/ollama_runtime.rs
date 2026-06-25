//! Start the local Ollama runtime. Readiness is an HTTP reachability probe in
//! the harness; this brings the server up so a "not running" state is one click
//! to fix instead of a dead end.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// Start Ollama's local server. Prefer a HEADLESS `ollama serve` (no window) so
/// the backend comes up without the menu-bar app taking over the screen; fall
/// back to launching the app (`open -a Ollama`) only when the CLI can't be
/// found. A spawned `serve` keeps running on :11434 with no UI.
#[tauri::command(async)]
pub fn ollama_start() -> Result<(), String> {
    if let Some(cli) = ollama_cli() {
        Command::new(&cli)
            .arg("serve")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("Couldn't start Ollama headless: {error}"))?;
        return Ok(());
    }
    let status = Command::new("open")
        .args(["-a", "Ollama"])
        .status()
        .map_err(|error| format!("Couldn't launch Ollama: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err("Ollama doesn't seem to be installed — get it from ollama.com.".to_owned())
    }
}

/// Resolve the `ollama` CLI from the usual install locations and the app
/// bundle's own copy (the menu-bar app installs a `/usr/local/bin` symlink on
/// first run, but a freshly-installed-but-never-opened app only has the bundled
/// binary). `None` → fall back to launching the app.
fn ollama_cli() -> Option<PathBuf> {
    let mut candidates = vec![
        PathBuf::from("/opt/homebrew/bin/ollama"),
        PathBuf::from("/usr/local/bin/ollama"),
        PathBuf::from("/Applications/Ollama.app/Contents/Resources/ollama"),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(Path::new(&home).join(".local/bin/ollama"));
        candidates
            .push(Path::new(&home).join("Applications/Ollama.app/Contents/Resources/ollama"));
    }
    candidates.into_iter().find(|path| path.exists())
}

/// Whether the Ollama app is installed — the menu-bar app `ollama_start` falls
/// back to. A filesystem check (no process spawn), so the first-run resolver can
/// tell "installed but stopped" (→ start it) from "not installed" (→ nudge to
/// download). The HTTP readiness probe can't: a stopped server and a missing one
/// both fail it identically.
#[tauri::command(async)]
pub fn ollama_installed() -> bool {
    if Path::new("/Applications/Ollama.app").exists() {
        return true;
    }
    std::env::var_os("HOME")
        .map(|home| Path::new(&home).join("Applications/Ollama.app").exists())
        .unwrap_or(false)
}
