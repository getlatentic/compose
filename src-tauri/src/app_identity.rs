//! Which copy of Compose is running: the shipped app or a test build under
//! its own bundle id, and where macOS keeps that copy's profile.

/// The current bundle identifier (must match `tauri.conf.json`).
#[cfg(target_os = "macos")]
pub(crate) const CURRENT_BUNDLE_ID: &str = "ai.latentic.compose";

/// The identifier of the copy that is running, which is what macOS keys its
/// profile by. A test build under its own id must read and reset its own
/// profile, never the installed app's. An unbundled dev binary has none and
/// uses the shipped id, as Tauri does.
#[cfg(target_os = "macos")]
pub(crate) fn running_bundle_id() -> &'static str {
    static ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    ID.get_or_init(|| {
        objc2_foundation::NSBundle::mainBundle()
            .bundleIdentifier()
            .map(|id| id.to_string())
            .unwrap_or_else(|| CURRENT_BUNDLE_ID.to_owned())
    })
}

/// True for the shipped app, whose profile older bundle ids are carried into.
#[cfg(target_os = "macos")]
pub(crate) fn is_shipped_identity() -> bool {
    running_bundle_id() == CURRENT_BUNDLE_ID
}

/// Where this app's state lives, resolved without an `AppHandle` so code that
/// runs before Tauri starts can read it. Matches what `app.path()` resolves
/// `app_config_dir` and `app_data_dir` to on macOS — the same directory.
#[cfg(target_os = "macos")]
pub fn profile_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(|home| {
        std::path::PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join(running_bundle_id())
    })
}

/// Only macOS keys its per-app directories by bundle identifier, and only macOS
/// ships today. Elsewhere the callers fall back to asking Tauri once it is up.
#[cfg(not(target_os = "macos"))]
pub fn profile_dir() -> Option<std::path::PathBuf> {
    None
}

