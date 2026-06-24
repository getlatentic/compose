//! One-time migration of the on-disk profile when the app's bundle identifier
//! changes. macOS derives the Application Support and WebKit (localStorage)
//! locations from the bundle id, so renaming it would otherwise orphan the
//! user's workspaces, vaults, custom agents, and every UI setting. This runs
//! before Tauri starts the webview, so the renamed build finds its data already
//! in place. It copies (never moves): the legacy profile stays intact as a
//! fallback, and a `dest exists` guard makes it a one-time, non-clobbering step.

/// The current bundle identifier (must match `tauri.conf.json`).
#[cfg(target_os = "macos")]
pub(crate) const CURRENT_BUNDLE_ID: &str = "ai.latentic.compose";

/// Bundle ids this app shipped under earlier, newest first. The first one whose
/// profile still exists is carried forward.
#[cfg(target_os = "macos")]
pub(crate) const LEGACY_BUNDLE_IDS: &[&str] = &["com.compose.app"];

/// `~/Library` subdirectories macOS keys by bundle id that hold app state worth
/// preserving: Application Support (workspaces, vaults, custom agents, metadata
/// db) and WebKit (the webview's localStorage — every UI setting). `Caches` is
/// intentionally skipped: it only holds the models.dev catalog, which re-fetches.
#[cfg(target_os = "macos")]
pub(crate) const PROFILE_SUBDIRS: &[&str] = &["Application Support", "WebKit"];

#[cfg(target_os = "macos")]
pub fn migrate_legacy_profile() {
    use std::path::PathBuf;

    let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
        return;
    };
    let library = home.join("Library");
    for subdir in PROFILE_SUBDIRS {
        let dest = library.join(subdir).join(CURRENT_BUNDLE_ID);
        if dest.exists() {
            continue; // already migrated, or the renamed build made its own — never clobber
        }
        let source = LEGACY_BUNDLE_IDS
            .iter()
            .map(|id| library.join(subdir).join(id))
            .find(|path| path.is_dir());
        let Some(source) = source else {
            continue;
        };
        // `ditto` is macOS's faithful recursive copy (symlinks, sqlite WAL files,
        // xattrs) — safer here than a hand-rolled walk.
        match std::process::Command::new("/usr/bin/ditto")
            .arg(&source)
            .arg(&dest)
            .status()
        {
            Ok(status) if status.success() => {
                eprintln!("profile migrated: {} -> {}", source.display(), dest.display());
            }
            Ok(status) => eprintln!("profile migration failed ({subdir}): ditto {status}"),
            Err(error) => eprintln!("profile migration failed ({subdir}): {error}"),
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn migrate_legacy_profile() {}
