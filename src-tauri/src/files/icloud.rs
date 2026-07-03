//! Dataless iCloud file handling.
//!
//! A dataless file (evicted from local storage) does NOT fail fast on read —
//! with a network available, `std::fs::read` BLOCKS while macOS downloads the
//! bytes, then succeeds. Bulk crawls (index rebuild, inventory) must therefore
//! detect datalessness BEFORE reading (`is_dataless`, stat-only) and skip, or
//! one rebuild turns into a minutes-long network crawl that wedges everything
//! sharing its stores (#106). Reads only fail when materialization is
//! impossible (offline, removed from iCloud).
//!
//! `start_download` (#26) is the complement: nudge a wanted file to
//! materialize so the NEXT read succeeds. Best-effort, idempotent, and
//! non-blocking — a no-op for files that aren't in iCloud.

use std::path::Path;

/// Stat shape of an iCloud placeholder: bytes are claimed (`len > 0`) but no
/// blocks are allocated locally. Pure, so the rule is testable anywhere; on
/// its own it also matches APFS-compressed/sparse LOCAL files, which is why
/// `is_dataless` additionally requires the item to be iCloud-managed.
pub(crate) fn dataless_shape(len: u64, blocks: u64) -> bool {
    len > 0 && blocks == 0
}

/// True when reading `path` would block on an iCloud download rather than
/// hitting local bytes. Stat + ubiquity check only — never materializes.
#[cfg(target_os = "macos")]
pub(crate) fn is_dataless(path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    dataless_shape(meta.len(), meta.blocks()) && is_ubiquitous(path)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn is_dataless(_path: &Path) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn is_ubiquitous(path: &Path) -> bool {
    use objc2_foundation::{NSFileManager, NSString, NSURL};

    let Some(path_str) = path.to_str() else {
        return false;
    };
    let url = NSURL::fileURLWithPath(&NSString::from_str(path_str));
    NSFileManager::defaultManager().isUbiquitousItemAtURL(&url)
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholder_shape_is_bytes_claimed_but_none_allocated() {
        assert!(dataless_shape(1024, 0));
        assert!(!dataless_shape(0, 0), "an empty file is trivially readable");
        assert!(!dataless_shape(1024, 8), "allocated blocks = bytes are local");
    }

    #[test]
    fn regular_files_are_never_dataless() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("note.md");
        std::fs::write(&path, "hello").expect("write");
        assert!(!is_dataless(&path));
        let empty = dir.path().join("empty.md");
        std::fs::write(&empty, "").expect("write");
        assert!(!is_dataless(&empty));
        assert!(!is_dataless(&dir.path().join("missing.md")));
    }
}
