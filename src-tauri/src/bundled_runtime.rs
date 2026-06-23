//! Wire Compose's bundled runtime (Node, uv) into the environment so the agent
//! CLIs need no system install. The bundled `node`/`npm`/`uv` go on PATH ahead
//! of any system install, and `npm install -g` (the harness's CLI installer) is
//! pointed at a *writable* prefix under the app's data dir — the `.app` itself is
//! read-only, so the bundled Node's own prefix can't take a global install.
//!
//! This is the only place that knows the bundled binaries exist: the harness
//! stays bundling-agnostic, just running CLIs against the inherited environment
//! (its `augmented_node_path` keeps the process PATH first, so these win).

use std::path::Path;

/// Put the bundled Node + uv ahead of system installs on PATH, and send
/// `npm install -g` to a writable prefix (`<data>/runtime/npm`) so a chosen CLI
/// agent (Claude/Codex/Bob) installs on first use without a system Node. Gated
/// on the bundled Node being present, so it's a no-op for a `pnpm dev` run or a
/// build made before the bundler. Must run before the first harness probe, since
/// `augmented_node_path` caches PATH on first use.
pub fn configure(resource_dir: &Path, data_dir: &Path) {
    let node_bin = resource_dir.join("runtime/node/bin");
    if !node_bin.is_dir() {
        return;
    }
    // Writable npm global prefix: where lazily-installed CLI agents land, and on
    // PATH so they're found. NPM_CONFIG_PREFIX redirects installs here (the
    // bundled Node's prefix is inside the read-only .app).
    let npm_prefix = data_dir.join("runtime/npm");
    let _ = std::fs::create_dir_all(npm_prefix.join("bin"));
    std::env::set_var("NPM_CONFIG_PREFIX", &npm_prefix);

    let prefix = [node_bin, resource_dir.join("runtime/bin"), npm_prefix.join("bin")]
        .iter()
        .filter(|path| path.is_dir())
        .filter_map(|path| path.to_str().map(str::to_owned))
        .collect::<Vec<_>>()
        .join(":");
    let path = match std::env::var("PATH") {
        Ok(existing) if !existing.is_empty() => format!("{prefix}:{existing}"),
        _ => prefix,
    };
    std::env::set_var("PATH", path);
}

/// Append the user's own toolchain dirs (every nvm node version, Homebrew, the
/// official-installer `~/.local/bin`) to PATH. A Finder-launched `.app` gets the
/// minimal launchd PATH, and the harness's login-shell PATH query can come back
/// *without* nvm — a heavy `~/.zshrc` whose lazy nvm init silently no-ops when
/// spawned with a stripped inherited PATH — so `bob`/`codex` (npm-global under
/// nvm) look "not installed" even though `node` (bundled) resolves. This adds
/// those dirs deterministically (no shell spawn), after the bundled binaries so
/// they still win. Runs before the first `augmented_node_path` call so the
/// cached PATH includes them.
pub fn append_user_tool_dirs() {
    let Ok(home) = std::env::var("HOME") else {
        return;
    };
    let home = Path::new(&home);
    let mut dirs: Vec<String> = Vec::new();
    // nvm-managed node versions — where npm-global CLIs (bob/claude/codex) live.
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
    let local = home.join(".local/bin");
    if let (true, Some(dir)) = (local.is_dir(), local.to_str()) {
        dirs.push(dir.to_owned());
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
