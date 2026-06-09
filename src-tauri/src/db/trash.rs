//! Bookkeeping for the recoverable trash.
//!
//! When [`crate::files::soft_delete`] moves a deleted file to
//! `<app-data>/trash/<vault_id>/<trashed_name>`, it records a row here so the
//! retention sweep ([`crate::files::trash_sweep`]) knows *when* each file was
//! trashed. The filesystem can't answer that on its own: a `rename` preserves
//! the file's content-mtime (which may be months old even for a file deleted
//! today), and the cross-device copy fallback stamps the copy time — neither is
//! the deletion moment. So the deletion time is recorded explicitly, here.
//!
//! Rows live in the global db (so one sweep query spans every vault) keyed by
//! `vault_id`; the physical file is located under the trash root by
//! `trashed_name`. `original_path` is kept for a future Trash/restore UI — the
//! sweep itself only needs `trashed_at`.

use super::{validate_relative_metadata_path, validate_storage_id, MetadataStore};
use rusqlite::params;
use uuid::Uuid;

/// One file sitting in the recoverable trash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrashEntry {
    /// Stable row id; pass to [`MetadataStore::delete_trash_entry`].
    pub id: String,
    pub vault_id: String,
    /// Where the file lived in the vault before deletion (workspace-relative).
    pub original_path: String,
    /// Basename under `<trash_root>/<vault_id>/`, i.e. `<uuid>-<original name>`.
    pub trashed_name: String,
    pub size_bytes: i64,
    /// Deletion time (epoch ms) — the retention window is measured from here.
    pub trashed_at: i64,
}

impl MetadataStore {
    /// Record that `original_path` was moved to the trash under `trashed_name`.
    /// `trashed_at` (epoch ms) is passed in so the caller stamps it once and the
    /// retention sweep stays testable. Returns the row id so the caller can roll
    /// the row back if the physical move then fails — keeping the invariant that
    /// every trashed file on disk has a row (else it could never be swept).
    pub fn record_trash_entry(
        &self,
        vault_id: &str,
        original_path: &str,
        trashed_name: &str,
        size_bytes: i64,
        trashed_at: i64,
    ) -> Result<String, String> {
        validate_storage_id(vault_id, "vault id")?;
        validate_relative_metadata_path(original_path)?;
        if trashed_name.trim().is_empty()
            || trashed_name.contains('/')
            || trashed_name.contains('\\')
        {
            return Err("trashed file name is invalid".to_owned());
        }
        let id = Uuid::new_v4().to_string();
        let connection = self.app_connection()?;
        connection
            .execute(
                "insert into trash_entries
                 (id, vault_id, original_path, trashed_name, size_bytes, trashed_at)
                 values (?1, ?2, ?3, ?4, ?5, ?6)",
                params![id, vault_id, original_path, trashed_name, size_bytes, trashed_at],
            )
            .map_err(|error| format!("could not record trash entry: {error}"))?;
        Ok(id)
    }

    /// Trash entries deleted strictly before `cutoff_ms`, oldest first — the
    /// retention sweep's purge list.
    pub fn expired_trash_entries(&self, cutoff_ms: i64) -> Result<Vec<TrashEntry>, String> {
        let connection = self.app_connection()?;
        let mut statement = connection
            .prepare(
                "select id, vault_id, original_path, trashed_name, size_bytes, trashed_at
                 from trash_entries
                 where trashed_at < ?1
                 order by trashed_at asc",
            )
            .map_err(|error| format!("could not prepare trash sweep query: {error}"))?;
        let rows = statement
            .query_map(params![cutoff_ms], |row| {
                Ok(TrashEntry {
                    id: row.get(0)?,
                    vault_id: row.get(1)?,
                    original_path: row.get(2)?,
                    trashed_name: row.get(3)?,
                    size_bytes: row.get(4)?,
                    trashed_at: row.get(5)?,
                })
            })
            .map_err(|error| format!("could not query expired trash entries: {error}"))?;
        let mut entries = Vec::new();
        for row in rows {
            entries.push(row.map_err(|error| format!("could not read trash entry: {error}"))?);
        }
        Ok(entries)
    }

    /// Drop a trash entry row by id — after its physical file is purged, or to
    /// roll back a row whose move failed. A missing id is a no-op.
    pub fn delete_trash_entry(&self, id: &str) -> Result<(), String> {
        let connection = self.app_connection()?;
        connection
            .execute("delete from trash_entries where id = ?1", params![id])
            .map_err(|error| format!("could not delete trash entry: {error}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn store() -> (tempfile::TempDir, MetadataStore) {
        let dir = tempdir().expect("temp dir");
        let store = MetadataStore::default();
        store.init_from_dir(dir.path()).expect("init metadata");
        (dir, store)
    }

    #[test]
    fn records_lists_expired_oldest_first_then_deletes() {
        let (_dir, store) = store();
        let old = store
            .record_trash_entry("vault-1", "old.md", "uuid-old.md", 10, 1_000)
            .expect("record old");
        let older = store
            .record_trash_entry("vault-1", "older.md", "uuid-older.md", 5, 500)
            .expect("record older");
        // Trashed after the cutoff → not expired.
        store
            .record_trash_entry("vault-1", "recent.md", "uuid-recent.md", 20, 10_000)
            .expect("record recent");

        let expired = store.expired_trash_entries(5_000).expect("expired");
        let ids: Vec<_> = expired.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids, vec![older.as_str(), old.as_str()], "oldest first");
        assert_eq!(expired[1].original_path, "old.md");
        assert_eq!(expired[1].size_bytes, 10);

        store.delete_trash_entry(&old).expect("delete old");
        let remaining = store.expired_trash_entries(5_000).expect("after delete");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, older);
    }

    #[test]
    fn rejects_traversal_path_and_nested_trashed_name() {
        let (_dir, store) = store();
        assert!(store
            .record_trash_entry("vault-1", "../escape.md", "uuid-escape.md", 1, 1)
            .is_err());
        assert!(store
            .record_trash_entry("vault-1", "ok.md", "nested/uuid-ok.md", 1, 1)
            .is_err());
    }

    #[test]
    fn cutoff_is_strict_so_boundary_entries_are_kept() {
        let (_dir, store) = store();
        store
            .record_trash_entry("vault-1", "edge.md", "uuid-edge.md", 1, 1_000)
            .expect("record");
        // trashed_at == cutoff is NOT < cutoff, so the entry survives.
        assert!(store.expired_trash_entries(1_000).expect("expired").is_empty());
        assert_eq!(store.expired_trash_entries(1_001).expect("expired").len(), 1);
    }
}
