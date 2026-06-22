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
