//! Retention sweep for the recoverable trash.
//!
//! Soft-deleted files move to `<app-data>/trash/...` and used to stay there
//! forever (review-guide.md hardening backlog item 2). This bounds that growth:
//! a file trashed more than [`TRASH_RETENTION_DAYS`] ago is *permanently*
//! removed. The sweep runs once at startup ([`run_startup_trash_sweep`]), off
//! the UI thread, since nothing in the running app depends on it.
//!
//! ## Why permanent deletion here is still safe
//!
//! A soft-delete records a content snapshot in version history *and* moves the
//! physical file to the trash — two independent recovery paths. Purging the
//! trash only removes the second; the file is still restorable from history via
//! `workspace_restore_version` until snapshot retention prunes that. Snapshot
//! retention is not implemented yet (snapshots are unbounded), so today a
//! purged file is always still recoverable from history.
//!
//! **Coherence invariant for whoever lands snapshot retention:** keep the
//! snapshot-retention window **≥ [`TRASH_RETENTION_DAYS`]**. If history were
//! pruned *sooner* than the trash, purging a trashed file could remove its last
//! recovery path earlier than this window promises.
//!
//! ## Scope (backend-only, by product decision)
//!
//! The window is a constant, not yet user-configurable, and there is no Trash
//! browser UI — both deliberately deferred. When a settings surface lands,
//! source the window from `app_settings` in [`run_startup_trash_sweep`] and
//! pass it through; [`sweep_expired_trash`] already takes it as a parameter.

use super::trash;
use crate::db::MetadataStore;

/// How long a soft-deleted file is kept in the recoverable trash before it is
/// permanently removed. 30 days matches the platform Trash / Drive convention
/// non-technical users already expect ("AI for everyone").
pub const TRASH_RETENTION_DAYS: i64 = 30;

const MS_PER_DAY: i64 = 24 * 60 * 60 * 1000;

/// What a sweep did, so the caller can surface it (never silently destroy
/// files) and tests can assert on it.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct TrashSweepReport {
    /// Files permanently removed (and whose rows were cleared).
    pub purged: usize,
    /// Total bytes those files occupied.
    pub bytes: i64,
    /// `"<trashed_name>: <error>"` for files that could not be removed; their
    /// rows are left so the next sweep retries.
    pub failed: Vec<String>,
}

/// Permanently remove every trash entry older than `retention_days`, deleting
/// the physical file first and only then its row (so a file that fails to
/// delete keeps its row and is retried next time). `now_ms` and `retention_days`
/// are injected so the sweep is testable without waiting real time.
pub fn sweep_expired_trash(
    metadata: &MetadataStore,
    now_ms: i64,
    retention_days: i64,
) -> Result<TrashSweepReport, String> {
    let trash_root = metadata.trash_root()?;
    let cutoff = now_ms.saturating_sub(retention_days.max(0).saturating_mul(MS_PER_DAY));
    let mut report = TrashSweepReport::default();
    for entry in metadata.expired_trash_entries(cutoff)? {
        match trash::purge_trashed_file(&trash_root, &entry.vault_id, &entry.trashed_name) {
            Ok(()) => {
                metadata.delete_trash_entry(&entry.id)?;
                report.purged += 1;
                report.bytes = report.bytes.saturating_add(entry.size_bytes);
            }
            Err(error) => report.failed.push(format!("{}: {error}", entry.trashed_name)),
        }
    }
    Ok(report)
}

/// Startup entry point: sweep with the default window and the current time,
/// logging the outcome. A sweep failure is logged, never fatal — it must not
/// block app launch.
pub fn run_startup_trash_sweep(metadata: &MetadataStore) {
    match sweep_expired_trash(metadata, crate::db::now_ms(), TRASH_RETENTION_DAYS) {
        Ok(report) if report.purged > 0 || !report.failed.is_empty() => {
            let mut line = format!(
                "trash sweep: permanently removed {} file(s) ({} bytes) trashed over {} days ago",
                report.purged, report.bytes, TRASH_RETENTION_DAYS
            );
            if !report.failed.is_empty() {
                line.push_str(&format!(
                    "; {} could not be removed: {}",
                    report.failed.len(),
                    report.failed.join(", ")
                ));
            }
            eprintln!("{line}");
        }
        Ok(_) => {}
        Err(error) => eprintln!("trash sweep failed: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    /// A metadata store plus a populated trash file for `vault`/`name`, with a
    /// recorded entry stamped at `trashed_at`.
    fn store() -> (tempfile::TempDir, MetadataStore) {
        let dir = tempdir().expect("data dir");
        let store = MetadataStore::default();
        store.init_from_dir(dir.path()).expect("init metadata");
        (dir, store)
    }

    fn seed_trashed_file(
        store: &MetadataStore,
        vault: &str,
        original_path: &str,
        name: &str,
        contents: &str,
        trashed_at: i64,
    ) -> String {
        let trash_root = store.trash_root().expect("trash root");
        let path = trash::trashed_path(&trash_root, vault, name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, contents).unwrap();
        store
            .record_trash_entry(vault, original_path, name, contents.len() as i64, trashed_at)
            .expect("record entry")
    }

    #[test]
    fn purges_files_older_than_the_window_and_keeps_recent_ones() {
        let (_dir, store) = store();
        let now = 100 * MS_PER_DAY;
        let old_at = now - 40 * MS_PER_DAY;
        let recent_at = now - MS_PER_DAY;
        seed_trashed_file(&store, "vault-1", "old.md", "u-old.md", "old body", old_at);
        let recent_id =
            seed_trashed_file(&store, "vault-1", "keep.md", "u-keep.md", "keep", recent_at);

        let report = sweep_expired_trash(&store, now, TRASH_RETENTION_DAYS).expect("sweep");

        assert_eq!(report.purged, 1);
        assert_eq!(report.bytes, "old body".len() as i64);
        assert!(report.failed.is_empty());

        let trash_root = store.trash_root().unwrap();
        assert!(
            !trash::trashed_path(&trash_root, "vault-1", "u-old.md").exists(),
            "expired file is permanently removed"
        );
        assert!(
            trash::trashed_path(&trash_root, "vault-1", "u-keep.md").exists(),
            "recent file is kept on disk"
        );
        // Only the recent row survives.
        let rows = store.expired_trash_entries(i64::MAX).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, recent_id);
    }

    #[test]
    fn clears_the_row_when_the_physical_file_is_already_gone() {
        let (_dir, store) = store();
        let now = 100 * MS_PER_DAY;
        // Record an old entry but never create the file (a prior partial sweep,
        // or a file the user emptied manually one day).
        store
            .record_trash_entry("vault-1", "ghost.md", "u-ghost.md", 0, now - 40 * MS_PER_DAY)
            .expect("record");

        let report = sweep_expired_trash(&store, now, TRASH_RETENTION_DAYS).expect("sweep");

        assert_eq!(report.purged, 1, "a missing file still clears its stale row");
        assert!(store.expired_trash_entries(i64::MAX).unwrap().is_empty());
    }

    #[test]
    fn keeps_everything_when_nothing_is_expired() {
        let (_dir, store) = store();
        let now = 100 * MS_PER_DAY;
        seed_trashed_file(&store, "v", "a.md", "u-a.md", "a", now - 5 * MS_PER_DAY);
        seed_trashed_file(&store, "v", "b.md", "u-b.md", "b", now - 2 * MS_PER_DAY);

        let report = sweep_expired_trash(&store, now, TRASH_RETENTION_DAYS).expect("sweep");

        assert_eq!(report, TrashSweepReport::default());
        assert_eq!(store.expired_trash_entries(i64::MAX).unwrap().len(), 2);
    }
}
