//! Diff a review clone against the live workspace.
//!
//! After a gated harness run, Compose compares the clone — where the agent
//! made its edits — against the user's real workspace to surface exactly what
//! changed: files created, modified, or deleted. Each change is fed into the
//! same accept/reject review UI bob's suggested edits already use. Comparison
//! is by SHA-256 content hash, so unchanged files are skipped without ever
//! looking at their bytes a second time.

use super::{is_ignored_segment, FileError};
use crate::db::content_hash_bytes;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;
use walkdir::WalkDir;

/// Largest file inlined into the review payload as text. Larger files — and
/// any file whose bytes are not valid UTF-8 — are reported as a change with
/// `preview_omitted` set and no inline text; the apply step still copies the
/// real bytes from the clone, so nothing is lost, only the on-screen preview.
pub(crate) const MAX_PREVIEW_BYTES: u64 = 1_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileChangeKind {
    Created,
    Modified,
    Deleted,
}

/// One file-level difference between the clone and the live workspace.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub relative_path: String,
    pub kind: FileChangeKind,
    /// The live file's current text (Modified / Deleted), when previewable.
    pub original_text: Option<String>,
    /// The clone's proposed text (Created / Modified), when previewable.
    pub new_text: Option<String>,
    /// True when either side is binary or too large to inline — the UI shows
    /// a size-only card rather than an inline diff.
    pub preview_omitted: bool,
    /// True when the live file changed since the pre-run baseline (e.g. the
    /// user edited it during the run), so accepting would overwrite that edit.
    /// Always false from [`diff_workspace`]; set by the review command, which
    /// is the only caller that knows the baseline. The UI warns before accept.
    pub stale: bool,
    pub original_size: u64,
    pub new_size: u64,
}

/// Compare `clone_root` (the agent's edited copy) against `real_root` (the
/// user's live workspace) and return every file-level change, sorted by path.
/// Unchanged files are omitted.
pub fn diff_workspace(clone_root: &Path, real_root: &Path) -> Result<Vec<FileChange>, FileError> {
    let clone_index = index_tree(clone_root)?;
    let real_index = index_tree(real_root)?;
    let mut changes = Vec::new();

    // Created (only in the clone) and Modified (in both, hash differs).
    for (relative_path, clone_entry) in &clone_index {
        match real_index.get(relative_path) {
            None => changes.push(build_change(
                FileChangeKind::Created,
                relative_path,
                clone_root,
                real_root,
                0,
                clone_entry.size,
            )?),
            Some(real_entry) if real_entry.hash != clone_entry.hash => changes.push(build_change(
                FileChangeKind::Modified,
                relative_path,
                clone_root,
                real_root,
                real_entry.size,
                clone_entry.size,
            )?),
            Some(_) => {}
        }
    }

    // Deleted (in the live workspace, gone from the clone).
    for (relative_path, real_entry) in &real_index {
        if !clone_index.contains_key(relative_path) {
            changes.push(build_change(
                FileChangeKind::Deleted,
                relative_path,
                clone_root,
                real_root,
                real_entry.size,
                0,
            )?);
        }
    }

    changes.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(changes)
}

struct IndexedFile {
    size: u64,
    hash: String,
}

/// Walk `root` (respecting the shared ignore rules) and hash every file by
/// content. A missing root yields an empty map — that is the natural state
/// when the clone created the workspace's first file or deleted its last.
fn index_tree(root: &Path) -> Result<BTreeMap<String, IndexedFile>, FileError> {
    let mut index = BTreeMap::new();
    if !root.exists() {
        return Ok(index);
    }
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            !is_ignored_segment(&entry.file_name().to_string_lossy())
        });

    for entry in walker {
        let entry = entry.map_err(|error| FileError::from(error.to_string()))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let relative_path = path
            .strip_prefix(root)
            .map_err(|error| FileError::from(error.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        let bytes = std::fs::read(path)?;
        index.insert(
            relative_path,
            IndexedFile {
                size: bytes.len() as u64,
                hash: content_hash_bytes(&bytes),
            },
        );
    }

    Ok(index)
}

fn build_change(
    kind: FileChangeKind,
    relative_path: &str,
    clone_root: &Path,
    real_root: &Path,
    original_size: u64,
    new_size: u64,
) -> Result<FileChange, FileError> {
    let (original_text, original_omitted) = match kind {
        FileChangeKind::Created => (None, false),
        _ => read_preview(&real_root.join(relative_path), original_size)?,
    };
    let (new_text, new_omitted) = match kind {
        FileChangeKind::Deleted => (None, false),
        _ => read_preview(&clone_root.join(relative_path), new_size)?,
    };
    Ok(FileChange {
        relative_path: relative_path.to_owned(),
        kind,
        original_text,
        new_text,
        preview_omitted: original_omitted || new_omitted,
        stale: false,
        original_size,
        new_size,
    })
}

/// Read a file for inline preview, returning `(text, omitted)`. Text is
/// returned only when the file is small enough and valid UTF-8; otherwise
/// `omitted` is true and the caller renders a size-only card.
fn read_preview(path: &Path, size: u64) -> Result<(Option<String>, bool), FileError> {
    if size > MAX_PREVIEW_BYTES {
        return Ok((None, true));
    }
    match std::fs::read(path) {
        Ok(bytes) => Ok(preview_from_bytes(&bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok((None, false)),
        Err(error) => Err(error.into()),
    }
}

/// Inline-preview decision for already-read bytes: text when small enough and
/// valid UTF-8, otherwise `(None, true)` (omitted). The single owner of the
/// "too big or binary ⇒ size-only card" policy — the snapshot-mode diff reads
/// the *after* side from disk and routes it through here too.
pub(crate) fn preview_from_bytes(bytes: &[u8]) -> (Option<String>, bool) {
    if bytes.len() as u64 > MAX_PREVIEW_BYTES {
        return (None, true);
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => (Some(text.to_owned()), false),
        Err(_) => (None, true),
    }
}

/// As [`preview_from_bytes`] for content already decoded to a `String` (the
/// snapshot-mode diff's *before* side comes from text history, not a file).
pub(crate) fn preview_from_text(text: String) -> (Option<String>, bool) {
    if text.len() as u64 > MAX_PREVIEW_BYTES {
        (None, true)
    } else {
        (Some(text), false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write(root: &Path, relative: &str, content: &[u8]) {
        let path = root.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    fn change_for<'a>(changes: &'a [FileChange], path: &str) -> &'a FileChange {
        changes
            .iter()
            .find(|change| change.relative_path == path)
            .unwrap_or_else(|| panic!("no change for {path}"))
    }

    #[test]
    fn detects_created_modified_deleted_and_skips_unchanged() {
        let real = tempdir().unwrap();
        let clone = tempdir().unwrap();

        // Unchanged in both → must not appear.
        write(real.path(), "keep.md", b"same");
        write(clone.path(), "keep.md", b"same");
        // Modified in the clone.
        write(real.path(), "notes/edit.md", b"before");
        write(clone.path(), "notes/edit.md", b"after");
        // Created only in the clone.
        write(clone.path(), "fresh.md", b"brand new");
        // Deleted (present in real, gone from clone).
        write(real.path(), "gone.md", b"removed");

        let changes = diff_workspace(clone.path(), real.path()).expect("diff");
        let paths: Vec<_> = changes.iter().map(|c| c.relative_path.as_str()).collect();
        assert_eq!(paths, vec!["fresh.md", "gone.md", "notes/edit.md"]);

        let created = change_for(&changes, "fresh.md");
        assert_eq!(created.kind, FileChangeKind::Created);
        assert_eq!(created.new_text.as_deref(), Some("brand new"));
        assert_eq!(created.original_text, None);

        let modified = change_for(&changes, "notes/edit.md");
        assert_eq!(modified.kind, FileChangeKind::Modified);
        assert_eq!(modified.original_text.as_deref(), Some("before"));
        assert_eq!(modified.new_text.as_deref(), Some("after"));

        let deleted = change_for(&changes, "gone.md");
        assert_eq!(deleted.kind, FileChangeKind::Deleted);
        assert_eq!(deleted.original_text.as_deref(), Some("removed"));
        assert_eq!(deleted.new_text, None);
    }

    #[test]
    fn ignores_dot_and_build_dirs_on_both_sides() {
        let real = tempdir().unwrap();
        let clone = tempdir().unwrap();
        write(clone.path(), ".git/HEAD", b"ref: changed");
        write(clone.path(), "node_modules/pkg/index.md", b"new dep");
        write(real.path(), "target/out.md", b"old build");

        let changes = diff_workspace(clone.path(), real.path()).expect("diff");
        assert!(changes.is_empty(), "ignored dirs must not produce changes");
    }

    #[test]
    fn binary_file_change_omits_inline_preview() {
        let real = tempdir().unwrap();
        let clone = tempdir().unwrap();
        // 0xFF is never a valid UTF-8 byte → both sides are non-previewable,
        // but the change is still reported.
        write(real.path(), "image.bin", &[0xff, 0xfe, 0x00]);
        write(clone.path(), "image.bin", &[0xff, 0x00, 0x01, 0x02]);

        let changes = diff_workspace(clone.path(), real.path()).expect("diff");
        let change = change_for(&changes, "image.bin");
        assert_eq!(change.kind, FileChangeKind::Modified);
        assert!(change.preview_omitted);
        assert_eq!(change.original_text, None);
        assert_eq!(change.new_text, None);
        assert_eq!(change.original_size, 3);
        assert_eq!(change.new_size, 4);
    }

    #[test]
    fn empty_when_clone_matches_workspace() {
        let real = tempdir().unwrap();
        let clone = tempdir().unwrap();
        write(real.path(), "a.md", b"x");
        write(clone.path(), "a.md", b"x");
        assert!(diff_workspace(clone.path(), real.path()).unwrap().is_empty());
    }
}
