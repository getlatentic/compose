//! Nudge dataless iCloud files to download so they load instead of getting
//! stuck blank (#26). A dataless file (evicted from local storage) can fail to
//! read; kicking `startDownloadingUbiquitousItem` makes iCloud materialize it so
//! the next open succeeds. Best-effort and idempotent — a no-op for files that
//! aren't in iCloud, and never blocks the caller.

use std::path::Path;

#[cfg(target_os = "macos")]
pub(crate) fn start_download(path: &Path) {
    use objc2_foundation::{NSFileManager, NSString, NSURL};

    let Some(path_str) = path.to_str() else {
        return;
    };
    let url = NSURL::fileURLWithPath(&NSString::from_str(path_str));
    let manager = NSFileManager::defaultManager();
    if manager.isUbiquitousItemAtURL(&url) {
        let _ = manager.startDownloadingUbiquitousItemAtURL_error(&url);
    }
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn start_download(_path: &Path) {}
