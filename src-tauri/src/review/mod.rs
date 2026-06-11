//! The edit-review gate for write-capable harnesses.
//!
//! bob proposes previewable edits and never writes to disk on its own, so it
//! needs nothing here. Claude / Codex edit files directly through their own
//! tools — which, for a non-technical user, means changes land with no review
//! and no undo. This module closes that gap:
//!
//! - **Clone gate** (review mode on): before the run, snapshot a baseline and
//!   clone the workspace into a temp sandbox; the harness runs with its working
//!   directory pointed at the clone, so the user's real files stay untouched
//!   mid-run. Afterward, [`review_diff`] reports what changed, the user
//!   approves per file, and [`apply_review_change`] writes the approved version
//!   back atomically (recording history) — deletes go to the recoverable trash.
//! - **Baseline only** (review mode off): the harness edits real files
//!   directly (today's behavior), but a baseline snapshot is recorded first so
//!   every edit stays undoable via "restore previous version".
//!
//! The frontend picks the mode per harness (capability + the user's toggle)
//! and sends it as [`EditGuard`]; the backend just acts on it. Cloning is
//! copy-on-write where the platform allows (see [`crate::files::clone`]).

use crate::db::{BaselineCandidate, MetadataStore};
use crate::files::clone::clone_workspace;
use crate::files::diff::{
    diff_workspace, preview_from_bytes, preview_from_text, FileChange, FileChangeKind,
};
use crate::workspace::WorkspaceRegistry;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::State;

/// How a run's edits should be guarded. Chosen by the frontend per harness.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum EditGuard {
    /// Harness handles its own review (bob) — do nothing.
    #[default]
    None,
    /// Direct edits, but snapshot a baseline first so they stay undoable.
    Snapshot,
    /// Run against a clone and review the diff before anything touches disk.
    Clone,
}

/// Per-run review state, keyed by run id. Holds two independent things:
/// `Clone`-mode sandboxes (a session owns its temp directory; dropping it via
/// [`ReviewSessionStore::close`] removes the clone from disk) and `Snapshot`-mode
/// baselines (the pre-run content reference used to diff what a direct-edit run
/// changed). A run uses exactly one of the two.
#[derive(Default)]
pub struct ReviewSessionStore {
    sessions: Mutex<HashMap<String, ReviewSession>>,
    baselines: Mutex<HashMap<String, SnapshotBaseline>>,
}

struct ReviewSession {
    workspace_id: String,
    real_root: PathBuf,
    /// The clone lives here; the `TempDir` deletes it on drop.
    clone: tempfile::TempDir,
}

/// The pre-run state of a `Snapshot`-mode run: where it ran, and which stored
/// revision holds each markdown file's content as of run start. The run edits
/// the real files directly (recording no snapshot of its own), so right after
/// the baseline pass the latest snapshot per file *is* the pre-run content —
/// which is what [`snapshot_diff`] compares the post-run files against.
#[derive(Clone)]
struct SnapshotBaseline {
    workspace_id: String,
    real_root: PathBuf,
    /// Relative path → the revision id whose snapshot is the pre-run content.
    files: HashMap<String, String>,
}

impl ReviewSessionStore {
    fn open(&self, run_id: &str, session: ReviewSession) -> Result<(), String> {
        self.sessions
            .lock()
            .map_err(|_| "review session lock was poisoned".to_owned())?
            .insert(run_id.to_owned(), session);
        Ok(())
    }

    /// `(workspace_id, real_root, clone_root)` for a run, cloned so callers do
    /// file I/O without holding the lock.
    fn paths(&self, run_id: &str) -> Option<(String, PathBuf, PathBuf)> {
        let guard = self.sessions.lock().ok()?;
        let session = guard.get(run_id)?;
        Some((
            session.workspace_id.clone(),
            session.real_root.clone(),
            session.clone.path().to_path_buf(),
        ))
    }

    fn open_baseline(&self, run_id: &str, baseline: SnapshotBaseline) -> Result<(), String> {
        self.baselines
            .lock()
            .map_err(|_| "review baseline lock was poisoned".to_owned())?
            .insert(run_id.to_owned(), baseline);
        Ok(())
    }

    /// A run's snapshot baseline, cloned so the diff reads history + disk
    /// without holding the lock.
    fn baseline(&self, run_id: &str) -> Option<SnapshotBaseline> {
        self.baselines.lock().ok()?.get(run_id).cloned()
    }

    /// Drop a run's review state — the clone sandbox (removing it from disk)
    /// and the snapshot baseline. Idempotent; a run only ever set one.
    fn close(&self, run_id: &str) {
        if let Ok(mut guard) = self.sessions.lock() {
            guard.remove(run_id);
        }
        if let Ok(mut guard) = self.baselines.lock() {
            guard.remove(run_id);
        }
    }
}

/// Prepare a run's working directory according to its [`EditGuard`], returning
/// the directory the harness should run in. For `Clone`, this records a
/// baseline, builds the sandbox, registers the session, and returns the clone
/// path; for `Snapshot`, records a baseline and returns the real root; for
/// `None`, returns the real root untouched.
pub fn prepare_edit_guard(
    guard: EditGuard,
    run_id: &str,
    workspace_id: &str,
    registry: &WorkspaceRegistry,
    metadata: &MetadataStore,
    store: &ReviewSessionStore,
) -> Result<PathBuf, String> {
    let real_root = registry.workspace_root(workspace_id)?;
    match guard {
        EditGuard::None => Ok(real_root),
        EditGuard::Snapshot => {
            snapshot_baseline(&real_root, workspace_id, metadata)?;
            // Capture the pre-run content reference so the post-run diff can
            // show what the agent changed directly on disk (it leaves no
            // suggestion previews of its own — see the module doc).
            let files = capture_baseline_manifest(&real_root, workspace_id, metadata)?;
            store.open_baseline(
                run_id,
                SnapshotBaseline {
                    workspace_id: workspace_id.to_owned(),
                    real_root: real_root.clone(),
                    files,
                },
            )?;
            Ok(real_root)
        }
        EditGuard::Clone => {
            // Baseline first: it is both the undo point and the reference the
            // diff uses to flag a file the user edits during the run.
            snapshot_baseline(&real_root, workspace_id, metadata)?;
            let sandbox = tempfile::TempDir::new()
                .map_err(|error| format!("could not create review sandbox: {error}"))?;
            let clone_root = sandbox.path().to_path_buf();
            clone_workspace(&real_root, &clone_root).map_err(|error| error.to_string())?;
            store.open(
                run_id,
                ReviewSession {
                    workspace_id: workspace_id.to_owned(),
                    real_root,
                    clone: sandbox,
                },
            )?;
            Ok(clone_root)
        }
    }
}

/// Record a content snapshot for every markdown file that doesn't already have
/// one for its current content, so the run's edits can be undone. Bounded by
/// [`MetadataStore::unbaselined_paths`] — unchanged, already-snapshotted files
/// are not re-read.
fn snapshot_baseline(
    real_root: &Path,
    workspace_id: &str,
    metadata: &MetadataStore,
) -> Result<(), String> {
    crate::files::ensure_vault_metadata(metadata, workspace_id, real_root)
        .map_err(|error| error.to_string())?;
    let entries =
        crate::files::scan_markdown_files(real_root).map_err(|error| error.to_string())?;
    let candidates: Vec<BaselineCandidate> = entries
        .iter()
        .map(|entry| BaselineCandidate {
            relative_path: entry.relative_path.clone(),
            last_modified_ms: entry.last_modified_ms,
            size_bytes: entry.size_bytes as i64,
        })
        .collect();
    let needs: HashSet<String> = metadata
        .unbaselined_paths(workspace_id, &candidates)?
        .into_iter()
        .collect();

    for entry in &entries {
        if !needs.contains(&entry.relative_path) {
            continue;
        }
        // Non-UTF-8 files can't be stored as text history; skip them (a clone
        // run still surfaces their changes in the diff and the trash recovers
        // them).
        let Ok(content) = std::fs::read_to_string(real_root.join(&entry.relative_path)) else {
            continue;
        };
        metadata.record_document_written(
            workspace_id,
            &entry.relative_path,
            &content,
            entry.last_modified_ms,
            entry.size_bytes,
        )?;
    }
    Ok(())
}

/// Compare a run's clone against the live workspace and return the file-level
/// changes, with `stale` set on any file the user changed during the run.
pub fn review_diff(
    store: &ReviewSessionStore,
    metadata: &MetadataStore,
    run_id: &str,
) -> Result<Vec<FileChange>, String> {
    let (workspace_id, real_root, clone_root) = store
        .paths(run_id)
        .ok_or_else(|| "no review is in progress for this run".to_owned())?;
    let mut changes = diff_workspace(&clone_root, &real_root).map_err(|error| error.to_string())?;
    for change in &mut changes {
        if change.kind == FileChangeKind::Created {
            continue;
        }
        let baseline = metadata.current_document_hash(&workspace_id, &change.relative_path)?;
        let current = std::fs::read(real_root.join(&change.relative_path))
            .ok()
            .map(|bytes| crate::db::content_hash_bytes(&bytes));
        change.stale = matches!((baseline, current), (Some(base), Some(now)) if base != now);
    }
    Ok(changes)
}

/// Snapshot the pre-run content reference for every markdown file: the latest
/// stored revision per file, which immediately after the baseline pass holds
/// its current (pre-run) content. Files with no text snapshot (non-UTF-8,
/// skipped by the baseline) are absent — their changes don't appear in the
/// text diff, matching the rest of the history model.
fn capture_baseline_manifest(
    real_root: &Path,
    workspace_id: &str,
    metadata: &MetadataStore,
) -> Result<HashMap<String, String>, String> {
    let entries =
        crate::files::scan_markdown_files(real_root).map_err(|error| error.to_string())?;
    let mut files = HashMap::new();
    for entry in &entries {
        let versions =
            metadata.list_document_versions(workspace_id, &entry.relative_path, None, 1)?;
        if let Some(version) = versions.first() {
            files.insert(entry.relative_path.clone(), version.revision_id.clone());
        }
    }
    Ok(files)
}

/// Compare a `Snapshot`-mode run's pre-run baseline against the now-edited real
/// files, returning the same [`FileChange`]s a clone review produces — except
/// these edits have *already* landed on disk (the diff is informational + the
/// undo point is version history, not a pending accept). Markdown-only, by the
/// same baseline-coverage reasoning as [`capture_baseline_manifest`].
pub fn snapshot_diff(
    store: &ReviewSessionStore,
    metadata: &MetadataStore,
    run_id: &str,
) -> Result<Vec<FileChange>, String> {
    let SnapshotBaseline {
        workspace_id,
        real_root,
        files,
    } = store
        .baseline(run_id)
        .ok_or_else(|| "no baseline was recorded for this run".to_owned())?;

    let mut changes = Vec::new();

    // Modified / Deleted: every file we baselined before the run.
    for (relative_path, revision_id) in &files {
        // The pre-run content. If its snapshot is somehow gone, skip this file
        // rather than fail the whole diff — a missing card beats no diff.
        let Ok(before) = metadata.document_version_content(&workspace_id, relative_path, revision_id)
        else {
            continue;
        };
        let before_hash = crate::db::content_hash(&before);
        match std::fs::read(real_root.join(relative_path)) {
            Ok(after_bytes) => {
                if crate::db::content_hash_bytes(&after_bytes) != before_hash {
                    changes.push(build_snapshot_change(
                        FileChangeKind::Modified,
                        relative_path,
                        Some(before),
                        Some(after_bytes),
                    ));
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                changes.push(build_snapshot_change(
                    FileChangeKind::Deleted,
                    relative_path,
                    Some(before),
                    None,
                ));
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    // Created: markdown files on disk now that weren't in the baseline.
    let current =
        crate::files::scan_markdown_files(&real_root).map_err(|error| error.to_string())?;
    for entry in &current {
        if files.contains_key(&entry.relative_path) {
            continue;
        }
        if let Ok(after_bytes) = std::fs::read(real_root.join(&entry.relative_path)) {
            changes.push(build_snapshot_change(
                FileChangeKind::Created,
                &entry.relative_path,
                None,
                Some(after_bytes),
            ));
        }
    }

    changes.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(changes)
}

/// Assemble a [`FileChange`] for the snapshot diff: the *before* side is text
/// from history, the *after* side is bytes from disk; both run through the
/// shared preview policy (size cap + UTF-8 guard) so binary/oversized files
/// degrade to a size-only card exactly as in the clone diff.
fn build_snapshot_change(
    kind: FileChangeKind,
    relative_path: &str,
    before: Option<String>,
    after: Option<Vec<u8>>,
) -> FileChange {
    let original_size = before.as_ref().map(|text| text.len() as u64).unwrap_or(0);
    let new_size = after.as_ref().map(|bytes| bytes.len() as u64).unwrap_or(0);
    let (original_text, original_omitted) = match before {
        Some(text) => preview_from_text(text),
        None => (None, false),
    };
    let (new_text, new_omitted) = match after {
        Some(bytes) => preview_from_bytes(&bytes),
        None => (None, false),
    };
    FileChange {
        relative_path: relative_path.to_owned(),
        kind,
        original_text,
        new_text,
        preview_omitted: original_omitted || new_omitted,
        stale: false,
        original_size,
        new_size,
    }
}

/// Apply one reviewed change to the real workspace: write the clone's version
/// of a created/modified file (recording history), or soft-delete a file the
/// run removed. The action is re-derived from the clone's current state, so a
/// stale request can't apply the wrong operation.
pub fn apply_review_change(
    store: &ReviewSessionStore,
    registry: &WorkspaceRegistry,
    metadata: &MetadataStore,
    run_id: &str,
    relative_path: &str,
) -> Result<(), String> {
    if !is_safe_relative(relative_path) {
        return Err("invalid file path".to_owned());
    }
    let (workspace_id, _real_root, clone_root) = store
        .paths(run_id)
        .ok_or_else(|| "no review is in progress for this run".to_owned())?;
    let clone_path = clone_root.join(relative_path);

    if clone_path.is_file() {
        // Created or modified — copy the clone's content to the real file.
        let bytes = std::fs::read(&clone_path).map_err(|error| error.to_string())?;
        match String::from_utf8(bytes) {
            Ok(text) => {
                crate::files::write_and_record(
                    registry,
                    metadata,
                    &workspace_id,
                    relative_path,
                    &text,
                )
                .map_err(|error| error.to_string())?;
            }
            Err(error) => {
                // Binary file — copy bytes atomically; not stored in text history.
                let destination = registry
                    .resolve_workspace_path(&workspace_id, relative_path)
                    .map_err(|error| error.to_string())?;
                crate::files::write_file_atomic(&destination, error.into_bytes())
                    .map_err(|error| error.to_string())?;
            }
        }
    } else {
        // Gone from the clone — the run deleted it; soft-delete the real file.
        crate::files::soft_delete(registry, metadata, &workspace_id, relative_path)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Reject path traversal / absolute / empty segments before joining a
/// caller-supplied relative path onto the clone root.
fn is_safe_relative(path: &str) -> bool {
    !path.starts_with('/')
        && !path.is_empty()
        && path
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

#[tauri::command(async)]
pub fn workspace_review_diff(
    run_id: String,
    metadata: State<'_, MetadataStore>,
    review: State<'_, ReviewSessionStore>,
) -> Result<Vec<FileChange>, String> {
    review_diff(&review, &metadata, &run_id)
}

/// What a `Snapshot`-mode run changed on disk, vs its pre-run baseline. Unlike
/// [`workspace_review_diff`] these edits are already applied; the frontend
/// shows them as an informational diff (undo via version history).
#[tauri::command(async)]
pub fn workspace_snapshot_diff(
    run_id: String,
    metadata: State<'_, MetadataStore>,
    review: State<'_, ReviewSessionStore>,
) -> Result<Vec<FileChange>, String> {
    snapshot_diff(&review, &metadata, &run_id)
}

#[tauri::command(async)]
pub fn workspace_apply_review_change(
    run_id: String,
    relative_path: String,
    registry: State<'_, WorkspaceRegistry>,
    metadata: State<'_, MetadataStore>,
    review: State<'_, ReviewSessionStore>,
) -> Result<(), String> {
    apply_review_change(&review, &registry, &metadata, &run_id, &relative_path)
}

#[tauri::command(async)]
pub fn workspace_review_cleanup(
    run_id: String,
    review: State<'_, ReviewSessionStore>,
) -> Result<(), String> {
    review.close(&run_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    /// A registry + metadata store + review store over a fresh workspace with
    /// the given seed files, returning everything plus the workspace id and
    /// root path.
    struct Harness {
        _data: tempfile::TempDir,
        _workspace: tempfile::TempDir,
        registry: WorkspaceRegistry,
        metadata: MetadataStore,
        review: ReviewSessionStore,
        workspace_id: String,
        root: PathBuf,
    }

    fn setup(seed: &[(&str, &str)]) -> Harness {
        let data = tempdir().expect("data dir");
        let workspace = tempdir().expect("workspace dir");
        for (relative, content) in seed {
            let path = workspace.path().join(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(path, content).unwrap();
        }
        let registry = WorkspaceRegistry::default();
        let list = registry
            .add(workspace.path().to_string_lossy().to_string())
            .expect("add workspace");
        let workspace_id = list.workspaces[0].id.clone();
        let metadata = MetadataStore::default();
        metadata.init_from_dir(data.path()).expect("init metadata");
        Harness {
            root: workspace.path().to_path_buf(),
            _data: data,
            _workspace: workspace,
            registry,
            metadata,
            review: ReviewSessionStore::default(),
            workspace_id,
        }
    }

    #[test]
    fn clone_guard_records_baseline_and_runs_in_an_isolated_sandbox() {
        let h = setup(&[("note.md", "original")]);
        let clone_root = prepare_edit_guard(
            EditGuard::Clone,
            "run-1",
            &h.workspace_id,
            &h.registry,
            &h.metadata,
            &h.review,
        )
        .expect("prepare clone");

        // The sandbox is a separate directory holding a copy of the file.
        assert_ne!(clone_root, h.root);
        assert_eq!(
            fs::read_to_string(clone_root.join("note.md")).unwrap(),
            "original"
        );
        // The baseline is restorable.
        let versions = h
            .metadata
            .list_document_versions(&h.workspace_id, "note.md", None, 10)
            .expect("versions");
        assert_eq!(versions.len(), 1);
    }

    #[test]
    fn diff_then_accept_applies_clone_edits_to_real_files() {
        let h = setup(&[("keep.md", "keep"), ("edit.md", "before")]);
        let clone_root = prepare_edit_guard(
            EditGuard::Clone,
            "run-1",
            &h.workspace_id,
            &h.registry,
            &h.metadata,
            &h.review,
        )
        .expect("prepare");

        // Simulate the harness editing the clone: modify, create, delete.
        fs::write(clone_root.join("edit.md"), "after").unwrap();
        fs::write(clone_root.join("new.md"), "fresh").unwrap();
        fs::remove_file(clone_root.join("keep.md")).unwrap();

        let changes = review_diff(&h.review, &h.metadata, "run-1").expect("diff");
        let paths: Vec<_> = changes.iter().map(|c| c.relative_path.as_str()).collect();
        assert_eq!(paths, vec!["edit.md", "keep.md", "new.md"]);
        assert!(changes.iter().all(|c| !c.stale), "nothing changed under us");

        // Real files are still untouched mid-review.
        assert_eq!(fs::read_to_string(h.root.join("edit.md")).unwrap(), "before");
        assert!(h.root.join("keep.md").exists());

        for change in &changes {
            apply_review_change(
                &h.review,
                &h.registry,
                &h.metadata,
                "run-1",
                &change.relative_path,
            )
            .expect("apply");
        }

        assert_eq!(fs::read_to_string(h.root.join("edit.md")).unwrap(), "after");
        assert_eq!(fs::read_to_string(h.root.join("new.md")).unwrap(), "fresh");
        assert!(!h.root.join("keep.md").exists(), "accepted deletion removed it");

        // The accepted edit is undoable back to the baseline.
        let versions = h
            .metadata
            .list_document_versions(&h.workspace_id, "edit.md", None, 10)
            .expect("versions");
        assert!(versions.len() >= 2);
    }

    #[test]
    fn diff_flags_a_file_the_user_changed_during_the_run() {
        let h = setup(&[("edit.md", "before")]);
        let clone_root = prepare_edit_guard(
            EditGuard::Clone,
            "run-1",
            &h.workspace_id,
            &h.registry,
            &h.metadata,
            &h.review,
        )
        .expect("prepare");

        // Agent edits the clone; meanwhile the user edits the real file.
        fs::write(clone_root.join("edit.md"), "agent version").unwrap();
        fs::write(h.root.join("edit.md"), "user typed here").unwrap();

        let changes = review_diff(&h.review, &h.metadata, "run-1").expect("diff");
        let change = changes
            .iter()
            .find(|c| c.relative_path == "edit.md")
            .expect("change");
        assert!(change.stale, "user's concurrent edit must flag the change");
    }

    #[test]
    fn snapshot_guard_records_baseline_without_a_sandbox() {
        let h = setup(&[("note.md", "v1")]);
        let cwd = prepare_edit_guard(
            EditGuard::Snapshot,
            "run-1",
            &h.workspace_id,
            &h.registry,
            &h.metadata,
            &h.review,
        )
        .expect("prepare snapshot");

        // Snapshot mode runs in the real workspace, not a sandbox, and opens
        // no review session. Compared via canonicalize: macOS resolves the
        // registry root (/var → /private/var) while the tempdir path doesn't.
        assert_eq!(
            cwd.canonicalize().unwrap(),
            h.root.canonicalize().unwrap()
        );
        assert!(h.review.paths("run-1").is_none());
        assert_eq!(
            h.metadata
                .list_document_versions(&h.workspace_id, "note.md", None, 10)
                .expect("versions")
                .len(),
            1
        );
    }

    #[test]
    fn snapshot_diff_reports_what_a_direct_edit_run_changed() {
        let h = setup(&[("keep.md", "keep"), ("edit.md", "before"), ("gone.md", "remove me")]);
        prepare_edit_guard(
            EditGuard::Snapshot,
            "run-1",
            &h.workspace_id,
            &h.registry,
            &h.metadata,
            &h.review,
        )
        .expect("prepare snapshot");

        // Snapshot mode: the agent edits the REAL files directly (no clone).
        fs::write(h.root.join("edit.md"), "after").unwrap();
        fs::write(h.root.join("new.md"), "fresh").unwrap();
        fs::remove_file(h.root.join("gone.md")).unwrap();

        let changes = snapshot_diff(&h.review, &h.metadata, "run-1").expect("snapshot diff");
        let paths: Vec<_> = changes.iter().map(|c| c.relative_path.as_str()).collect();
        assert_eq!(paths, vec!["edit.md", "gone.md", "new.md"]);

        let modified = changes.iter().find(|c| c.relative_path == "edit.md").unwrap();
        assert_eq!(modified.kind, FileChangeKind::Modified);
        assert_eq!(modified.original_text.as_deref(), Some("before"));
        assert_eq!(modified.new_text.as_deref(), Some("after"));

        let created = changes.iter().find(|c| c.relative_path == "new.md").unwrap();
        assert_eq!(created.kind, FileChangeKind::Created);
        assert_eq!(created.original_text, None);
        assert_eq!(created.new_text.as_deref(), Some("fresh"));

        let deleted = changes.iter().find(|c| c.relative_path == "gone.md").unwrap();
        assert_eq!(deleted.kind, FileChangeKind::Deleted);
        assert_eq!(deleted.original_text.as_deref(), Some("remove me"));
        assert_eq!(deleted.new_text, None);
    }

    #[test]
    fn snapshot_diff_is_empty_when_the_run_changed_nothing() {
        let h = setup(&[("note.md", "unchanged")]);
        prepare_edit_guard(
            EditGuard::Snapshot,
            "run-1",
            &h.workspace_id,
            &h.registry,
            &h.metadata,
            &h.review,
        )
        .expect("prepare snapshot");

        let changes = snapshot_diff(&h.review, &h.metadata, "run-1").expect("snapshot diff");
        assert!(changes.is_empty(), "no edits ⇒ no changes");
    }

    #[test]
    fn snapshot_diff_errors_without_a_recorded_baseline() {
        let h = setup(&[("note.md", "x")]);
        assert!(snapshot_diff(&h.review, &h.metadata, "never-prepared").is_err());
    }

    #[test]
    fn closing_clears_a_snapshot_baseline() {
        let h = setup(&[("note.md", "x")]);
        prepare_edit_guard(
            EditGuard::Snapshot,
            "run-1",
            &h.workspace_id,
            &h.registry,
            &h.metadata,
            &h.review,
        )
        .expect("prepare snapshot");
        assert!(snapshot_diff(&h.review, &h.metadata, "run-1").is_ok());
        h.review.close("run-1");
        assert!(snapshot_diff(&h.review, &h.metadata, "run-1").is_err());
    }

    #[test]
    fn apply_rejects_path_traversal() {
        let h = setup(&[("note.md", "x")]);
        prepare_edit_guard(
            EditGuard::Clone,
            "run-1",
            &h.workspace_id,
            &h.registry,
            &h.metadata,
            &h.review,
        )
        .expect("prepare");
        assert!(apply_review_change(
            &h.review,
            &h.registry,
            &h.metadata,
            "run-1",
            "../escape.md"
        )
        .is_err());
    }

    #[test]
    fn cleanup_removes_the_sandbox() {
        let h = setup(&[("note.md", "x")]);
        let clone_root = prepare_edit_guard(
            EditGuard::Clone,
            "run-1",
            &h.workspace_id,
            &h.registry,
            &h.metadata,
            &h.review,
        )
        .expect("prepare");
        assert!(clone_root.exists());
        h.review.close("run-1");
        assert!(!clone_root.exists(), "closing drops the temp dir");
        assert!(h.review.paths("run-1").is_none());
    }
}
