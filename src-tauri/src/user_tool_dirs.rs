//! PATH discovery for a Finder-launched `.app`: append the user's own toolchain
//! directories so their installed CLIs resolve. Discovery only — Compose finds
//! what the user installed; it never installs or bundles a runtime.

use std::path::Path;

/// Append the user's toolchain dirs (every nvm node version, Homebrew, the
/// official-installer `~/.local/bin`) to PATH. A Finder-launched `.app` gets the
/// minimal launchd PATH, and the harness's login-shell PATH query can come back
/// *without* nvm — a heavy `~/.zshrc` whose lazy nvm init silently no-ops when
/// spawned with a stripped inherited PATH — so an npm-global `codex` looks "not
/// installed" even though it's right there. This adds those dirs
/// deterministically (no shell spawn). Runs before the first
/// `augmented_node_path` call so the cached PATH includes them.
pub fn append() {
    let Ok(home) = std::env::var("HOME") else {
        return;
    };
    let home = Path::new(&home);
    let mut dirs: Vec<String> = Vec::new();
    // Official native installers (`~/.local/bin`) come FIRST. They auto-update
    // and are the vendor-canonical path, so they must win over a package-manager
    // copy of the same CLI. Concretely: Claude Code's npm package
    // (`@anthropic-ai/claude-code`) is frozen at 1.0.x — the native installer
    // superseded it — so an nvm-global `claude` is a stale trap (its 1.0.x maps
    // the `sonnet` alias to a now-deleted model id → 404 → the agent exits 1).
    // Preferring the native binary keeps a fresh, self-updating CLI in front.
    let local = home.join(".local/bin");
    if let (true, Some(dir)) = (local.is_dir(), local.to_str()) {
        dirs.push(dir.to_owned());
    }
    // nvm-managed node versions — where npm-global CLIs (codex) live.
    if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
        for entry in entries.flatten() {
            let bin = entry.path().join("bin");
            if let (true, Some(dir)) = (bin.is_dir(), bin.to_str()) {
                dirs.push(dir.to_owned());
            }
        }
    }
    for system in ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"] {
        if Path::new(system).is_dir() {
            dirs.push(system.to_owned());
        }
    }
    if dirs.is_empty() {
        return;
    }
    let appended = dirs.join(":");
    let path = match std::env::var("PATH") {
        Ok(existing) if !existing.is_empty() => format!("{existing}:{appended}"),
        _ => appended,
    };
    std::env::set_var("PATH", path);
}
