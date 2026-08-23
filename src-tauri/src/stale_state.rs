//! Remove state a removed feature left in the app data dir.
//!
//! Deleting a feature doesn't delete what it already wrote to every user's
//! machine, and that residue outlives the code that explains it. Each entry
//! here is a directory some shipped version created and no version reads any
//! more, so a build that drops a feature also cleans up after it.

use std::path::Path;

/// Directories under the app data dir owned by features that no longer exist.
/// A registry, so retiring the next feature is one line.
const REMOVED_STATE_DIRS: &[&str] = &[
    // The bundled Node/uv runtime's writable npm prefix (`NPM_CONFIG_PREFIX`),
    // where lazily-installed CLI agents landed. Compose bundles no runtime and
    // installs no agents, so nothing writes or reads this.
    "runtime",
];

/// Delete every removed feature's leftovers under `data_dir`. Best-effort and
/// idempotent: a missing directory is the normal case after the first run, and
/// a failure to remove is not worth failing a launch over.
pub fn sweep(data_dir: &Path) {
    for name in REMOVED_STATE_DIRS {
        let path = data_dir.join(name);
        if path.is_dir() {
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_the_dead_runtime_prefix_and_leaves_live_state() {
        let dir = tempfile::tempdir().expect("tempdir");
        let runtime = dir.path().join("runtime/npm/bin");
        std::fs::create_dir_all(&runtime).expect("runtime tree");
        std::fs::write(runtime.join("codex"), b"shim").expect("stale binary");
        std::fs::write(dir.path().join("app.db"), b"live").expect("live db");
        std::fs::create_dir_all(dir.path().join("vaults")).expect("live dir");

        sweep(dir.path());

        assert!(!dir.path().join("runtime").exists(), "the dead prefix must go");
        assert!(dir.path().join("app.db").is_file(), "live state must survive");
        assert!(dir.path().join("vaults").is_dir(), "live dirs must survive");
    }

    #[test]
    fn is_idempotent_and_survives_a_missing_data_dir() {
        let dir = tempfile::tempdir().expect("tempdir");
        sweep(dir.path()); // nothing to remove
        sweep(dir.path()); // still nothing — must not panic
        sweep(&dir.path().join("does-not-exist"));
    }
}
