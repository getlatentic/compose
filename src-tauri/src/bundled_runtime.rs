//! Put Compose's bundled runtime (Node, uv) on PATH so the agent CLIs use it
//! instead of requiring a system install. This is the ONLY place that knows the
//! bundled binaries exist: the harness stays bundling-agnostic — it just runs
//! CLIs against the inherited PATH (its `augmented_node_path` keeps the process
//! PATH first), so prepending here is all it takes for the bundled tools to win.

use std::path::Path;

/// Prepend the bundled Node + uv bin dirs (under the app's resource dir) to
/// PATH, ahead of any system install. A no-op for dirs that aren't present (a
/// `pnpm dev` run, or before the bundler ships them), so it's always safe to
/// call. Must run before the first harness probe, since `augmented_node_path`
/// caches the PATH on first use.
pub fn prepend_bundled_runtime(resource_dir: &Path) {
    // Layout convention shared with the bundler: `runtime/node/bin` (node, npm,
    // npx) and `runtime/bin` (uv) under the app's Resources.
    let bundled: Vec<String> = [
        resource_dir.join("runtime/node/bin"),
        resource_dir.join("runtime/bin"),
    ]
    .into_iter()
    .filter(|path| path.is_dir())
    .filter_map(|path| path.to_str().map(str::to_owned))
    .collect();
    if bundled.is_empty() {
        return;
    }
    let prefix = bundled.join(":");
    let path = match std::env::var("PATH") {
        Ok(existing) if !existing.is_empty() => format!("{prefix}:{existing}"),
        _ => prefix,
    };
    std::env::set_var("PATH", path);
}
