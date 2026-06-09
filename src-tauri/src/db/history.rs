//! Git-free document version history.
//!
//! Compose records a content snapshot whenever it writes a document — and,
//! crucially, just before a write-capable harness runs (the baseline pass),
//! so an assistant's edit is always reversible. This module reads that
//! history back: list the recent versions of a file, fetch a chosen prior
//! version's content, and decide which files still need a baseline snapshot.
//! Restoring is a plain write of old content over the current file (handled
//! in the files layer) — never a VCS operation.

use super::{validate_relative_metadata_path, validate_storage_id, MetadataStore};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;

/// One restorable prior version of a document, newest first in a list.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentVersion {
    /// Stable id used to fetch this version's content / restore it.
    pub revision_id: String,
    /// When this version was captured (epoch ms).
    pub created_at: i64,
    /// Byte length of the stored content.
    pub size_bytes: i64,
    /// True when this version matches the file's current on-disk content.
    pub is_current: bool,
}

/// A scanned file the caller is considering for a baseline snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BaselineCandidate {
    pub relative_path: String,
    pub last_modified_ms: i64,
    pub size_bytes: i64,
}

impl MetadataStore {
    /// Recent restorable versions of `relative_path`, newest first, capped at
    /// `limit`. `current_hash` is the live file's content hash (if it exists),
    /// used only to flag which version is the one currently on disk. Returns
    /// an empty list for an unknown document.
    pub fn list_document_versions(
        &self,
        vault_id: &str,
        relative_path: &str,
        current_hash: Option<&str>,
        limit: u32,
    ) -> Result<Vec<DocumentVersion>, String> {
        validate_storage_id(vault_id, "vault id")?;
        validate_relative_metadata_path(relative_path)?;
        let connection = self.vault_connection(vault_id)?;
        let doc_id = match doc_id_for_path_any(&connection, relative_path)
            .map_err(|error| format!("could not resolve document: {error}"))?
        {
            Some(doc_id) => doc_id,
            None => return Ok(Vec::new()),
        };

        let mut statement = connection
            .prepare(
                "select s.revision_id, s.content_hash, length(s.compressed_text), r.created_at
                 from document_snapshots s
                 join document_revisions r on r.revision_id = s.revision_id
                 where s.doc_id = ?1
                 order by r.created_at desc, s.snapshot_id desc
                 limit ?2",
            )
            .map_err(|error| format!("could not prepare version history query: {error}"))?;
        let rows = statement
            .query_map(params![doc_id, limit as i64], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(|error| format!("could not query version history: {error}"))?;

        let mut versions = Vec::new();
        for row in rows {
            let (revision_id, content_hash, size_bytes, created_at) =
                row.map_err(|error| format!("could not read version history: {error}"))?;
            versions.push(DocumentVersion {
                is_current: current_hash == Some(content_hash.as_str()),
                revision_id,
                created_at,
                size_bytes,
            });
        }
        Ok(versions)
    }

    /// Content of one stored version of `relative_path`. Errors if the
    /// revision is unknown for that document or its snapshot is gone.
    pub fn document_version_content(
        &self,
        vault_id: &str,
        relative_path: &str,
        revision_id: &str,
    ) -> Result<String, String> {
        validate_storage_id(vault_id, "vault id")?;
        validate_relative_metadata_path(relative_path)?;
        let connection = self.vault_connection(vault_id)?;
        let blob: Option<Vec<u8>> = connection
            .query_row(
                "select s.compressed_text
                 from document_snapshots s
                 join documents d on d.doc_id = s.doc_id
                 where s.revision_id = ?1 and d.current_path = ?2
                 limit 1",
                params![revision_id, relative_path],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("could not load stored version: {error}"))?;
        let blob = blob.ok_or_else(|| "that version is no longer available".to_owned())?;
        String::from_utf8(blob).map_err(|error| format!("stored version is not valid text: {error}"))
    }

    /// Of the scanned `candidates`, the paths that still need a baseline
    /// snapshot before a run — anything new, changed on disk since we last
    /// saw it, or whose current content has no snapshot yet. Unchanged,
    /// already-snapshotted files are skipped so a pre-run baseline doesn't
    /// re-read the whole vault every time.
    pub fn unbaselined_paths(
        &self,
        vault_id: &str,
        candidates: &[BaselineCandidate],
    ) -> Result<Vec<String>, String> {
        validate_storage_id(vault_id, "vault id")?;
        let connection = self.vault_connection(vault_id)?;
        let mut statement = connection
            .prepare(
                "select d.current_path, d.last_seen_mtime, d.last_seen_size,
                   exists(
                     select 1 from document_snapshots s
                     where s.doc_id = d.doc_id and s.content_hash = d.content_hash
                   )
                 from documents d
                 where d.deleted_at is null",
            )
            .map_err(|error| format!("could not prepare baseline query: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, bool>(3)?,
                ))
            })
            .map_err(|error| format!("could not query baseline state: {error}"))?;

        let mut known: HashMap<String, (Option<i64>, Option<i64>, bool)> = HashMap::new();
        for row in rows {
            let (path, mtime, size, has_snapshot) =
                row.map_err(|error| format!("could not read baseline state: {error}"))?;
            known.insert(path, (mtime, size, has_snapshot));
        }

        let mut needs = Vec::new();
        for candidate in candidates {
            let baselined = matches!(
                known.get(&candidate.relative_path),
                Some((Some(mtime), Some(size), true))
                    if *mtime == candidate.last_modified_ms && *size == candidate.size_bytes
            );
            if !baselined {
                needs.push(candidate.relative_path.clone());
            }
        }
        Ok(needs)
    }
}

/// Resolve a document id by current path, preferring the live row but falling
/// back to a soft-deleted one so a just-deleted file's history is still
/// readable.
fn doc_id_for_path_any(
    connection: &Connection,
    relative_path: &str,
) -> rusqlite::Result<Option<String>> {
    connection
        .query_row(
            "select doc_id from documents
             where current_path = ?1
             order by case when deleted_at is null then 0 else 1 end, updated_at desc
             limit 1",
            params![relative_path],
            |row| row.get(0),
        )
        .optional()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{content_hash, DocumentInventoryEntry};
    use std::path::Path;
    use tempfile::tempdir;

    fn store_with_doc() -> (tempfile::TempDir, MetadataStore, &'static str) {
        let dir = tempdir().expect("temp dir");
        let store = MetadataStore::default();
        store.init_from_dir(dir.path()).expect("init metadata");
        store
            .ensure_vault("vault-1", "Vault", Path::new("/tmp/vault"))
            .expect("ensure vault");
        (dir, store, "vault-1")
    }

    #[test]
    fn lists_recent_versions_newest_first_and_returns_content() {
        let (_dir, store, vault_id) = store_with_doc();
        store
            .record_document_written(vault_id, "note.md", "first", 10, 5)
            .expect("write v1");
        store
            .record_document_written(vault_id, "note.md", "second draft", 20, 12)
            .expect("write v2");

        let versions = store
            .list_document_versions(vault_id, "note.md", Some(&content_hash("second draft")), 10)
            .expect("list versions");
        assert_eq!(versions.len(), 2);
        // Newest first; the latest matches current content.
        assert!(versions[0].is_current);
        assert!(!versions[1].is_current);
        assert!(versions[0].created_at >= versions[1].created_at);
        assert_eq!(versions[0].size_bytes, "second draft".len() as i64);

        let restored = store
            .document_version_content(vault_id, "note.md", &versions[1].revision_id)
            .expect("read older version");
        assert_eq!(restored, "first");
    }

    #[test]
    fn record_document_written_backfills_snapshot_after_sync_only_revision() {
        // A plain scan records a revision with no snapshot blob. A later write
        // of the SAME content must still leave a restorable snapshot — the
        // guarantee `record_document_written` makes and the baseline pass
        // depends on.
        let (_dir, store, vault_id) = store_with_doc();
        store
            .sync_documents(
                vault_id,
                vec![DocumentInventoryEntry {
                    content_hash: content_hash("synced body"),
                    last_seen_mtime: 10,
                    last_seen_size: 11,
                    relative_path: "note.md".to_owned(),
                    title: None,
                }],
            )
            .expect("sync");

        assert!(
            store
                .list_document_versions(vault_id, "note.md", None, 10)
                .expect("list after sync")
                .is_empty(),
            "a sync-only revision has no snapshot to restore"
        );

        store
            .record_document_written(vault_id, "note.md", "synced body", 10, 11)
            .expect("write same content");

        let versions = store
            .list_document_versions(vault_id, "note.md", None, 10)
            .expect("list after write");
        assert_eq!(versions.len(), 1);
        assert_eq!(
            store
                .document_version_content(vault_id, "note.md", &versions[0].revision_id)
                .expect("content"),
            "synced body"
        );
    }

    #[test]
    fn unbaselined_paths_skips_already_baselined_files() {
        let (_dir, store, vault_id) = store_with_doc();
        store
            .record_document_written(vault_id, "kept.md", "stable", 100, 6)
            .expect("baseline kept");

        let candidates = vec![
            // Same mtime + size as recorded, content snapshotted → skip.
            BaselineCandidate {
                relative_path: "kept.md".to_owned(),
                last_modified_ms: 100,
                size_bytes: 6,
            },
            // Never seen → needs baseline.
            BaselineCandidate {
                relative_path: "fresh.md".to_owned(),
                last_modified_ms: 50,
                size_bytes: 3,
            },
            // Known path but changed on disk (newer mtime) → needs baseline.
            BaselineCandidate {
                relative_path: "kept.md".to_owned(),
                last_modified_ms: 200,
                size_bytes: 6,
            },
        ];

        let needs = store
            .unbaselined_paths(vault_id, &candidates)
            .expect("unbaselined");
        assert_eq!(needs, vec!["fresh.md".to_owned(), "kept.md".to_owned()]);
    }

    #[test]
    fn list_versions_unknown_document_is_empty() {
        let (_dir, store, vault_id) = store_with_doc();
        assert!(store
            .list_document_versions(vault_id, "missing.md", None, 10)
            .expect("list")
            .is_empty());
    }
}
