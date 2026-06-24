//! "Reset all data" — wipe Compose's on-disk profile so the next launch is a
//! fresh first-run, without touching the user's note files (those live in their
//! own folders, not the app profile). Two-phase: the `app_reset_all_data`
//! command forgets the saved keys, drops a marker, and restarts; on the next
//! boot — before the migration or the webview can repopulate anything —
//! [`apply_pending_reset`] does the on-disk wipe. The split lets the webview's
//! localStorage be cleared at a moment when it isn't being held open.

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::OsStr;
    use std::path::{Path, PathBuf};

    use crate::profile_migration::{CURRENT_BUNDLE_ID, LEGACY_BUNDLE_IDS, PROFILE_SUBDIRS};

    /// Left in Application Support to carry a pending reset across the restart.
    const MARKER: &str = ".reset-pending";
    /// Application Support entries kept across a reset: the bundled Node/uv
    /// runtime (so CLI agents needn't reinstall) and the local diagnostics log.
    const PRESERVE: &[&str] = &["runtime", "logs"];

    fn library() -> Option<PathBuf> {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library"))
    }

    fn support_dir() -> Option<PathBuf> {
        library().map(|lib| lib.join("Application Support").join(CURRENT_BUNDLE_ID))
    }

    pub fn request_reset() -> Result<(), String> {
        let dir = support_dir().ok_or("no home directory")?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(dir.join(MARKER), b"").map_err(|e| e.to_string())
    }

    pub fn apply_pending_reset() {
        let Some(support) = support_dir() else {
            return;
        };
        if !support.join(MARKER).exists() {
            return;
        }
        clear_contents(&support, PRESERVE);
        // localStorage and any older-bundle profile would otherwise repopulate
        // settings or be re-migrated on the way up — remove them wholesale.
        if let Some(lib) = library() {
            let _ = std::fs::remove_dir_all(lib.join("WebKit").join(CURRENT_BUNDLE_ID));
            for legacy in LEGACY_BUNDLE_IDS {
                for subdir in PROFILE_SUBDIRS {
                    let _ = std::fs::remove_dir_all(lib.join(subdir).join(legacy));
                }
            }
        }
        eprintln!("data reset applied");
    }

    fn clear_contents(dir: &Path, preserve: &[&str]) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            if preserve.iter().any(|kept| name.as_os_str() == OsStr::new(kept)) {
                continue;
            }
            let path = entry.path();
            let _ = if path.is_dir() {
                std::fs::remove_dir_all(&path)
            } else {
                std::fs::remove_file(&path)
            };
        }
    }
}

#[cfg(target_os = "macos")]
pub use macos::{apply_pending_reset, request_reset};

#[cfg(not(target_os = "macos"))]
pub fn apply_pending_reset() {}

#[cfg(not(target_os = "macos"))]
pub fn request_reset() -> Result<(), String> {
    Err("Resetting all data is only supported on macOS.".to_owned())
}

/// Forget the saved keys, mark a reset for the next boot, and restart so
/// [`apply_pending_reset`] can wipe the profile before the webview loads. The
/// restart diverges, so a success never returns to the caller.
#[tauri::command(async)]
pub fn app_reset_all_data(app: tauri::AppHandle) -> Result<(), String> {
    crate::harness::credentials::forget_all();
    request_reset()?;
    app.restart();
}
