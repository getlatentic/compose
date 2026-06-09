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
                // Report the *uncompressed* size: stored explicitly for
                // compressed rows, falling back to the blob length for legacy
                // (pre-compression) rows where blob length == content length.
                "select s.revision_id, s.content_hash,
                        coalesce(s.uncompressed_size, length(s.compressed_text)), r.created_at
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
        let stored: Option<(Vec<u8>, i64)> = connection
            .query_row(
                "select s.compressed_text, s.codec
                 from document_snapshots s
                 join documents d on d.doc_id = s.doc_id
                 where s.revision_id = ?1 and d.current_path = ?2
                 limit 1",
                params![revision_id, relative_path],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|error| format!("could not load stored version: {error}"))?;
        let (blob, codec) =
            stored.ok_or_else(|| "that version is no longer available".to_owned())?;
        let bytes = super::snapshot::decode_snapshot(&blob, codec)?;
        String::from_utf8(bytes).map_err(|error| format!("stored version is not valid text: {error}"))
    }

    /// The content hash metadata last recorded for a live document, if any.
    /// After a pre-run baseline this is the pre-run content hash, so the
    /// review command can flag a file the user changed during the run.
    pub fn current_document_hash(
        &self,
        vault_id: &str,
        relative_path: &str,
    ) -> Result<Option<String>, String> {
        validate_storage_id(vault_id, "vault id")?;
        validate_relative_metadata_path(relative_path)?;
        let connection = self.vault_connection(vault_id)?;
        connection
            .query_row(
                "select content_hash from documents
                 where current_path = ?1 and deleted_at is null
                 limit 1",
                params![relative_path],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("could not load document hash: {error}"))
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
    use crate::db::snapshot::SNAPSHOT_RETENTION_LIMIT;
    use crate::db::{
        content_hash, DocumentEdit, DocumentInventoryEntry, DocumentTextChange,
        LlmContextSnapshotRequest, LlmThreadRecordRequest, SourceRange,
    };
    use std::path::Path;
    use tempfile::tempdir;

    fn count_for_doc(store: &MetadataStore, vault_id: &str, table: &str, doc_id: &str) -> i64 {
        let connection = store.vault_connection(vault_id).expect("connection");
        connection
            .query_row(
                &format!("select count(*) from {table} where doc_id = ?1"),
                params![doc_id],
                |row| row.get(0),
            )
            .expect("count")
    }

    fn doc_id_for(store: &MetadataStore, vault_id: &str, relative_path: &str) -> String {
        let connection = store.vault_connection(vault_id).expect("connection");
        connection
            .query_row(
                "select doc_id from documents where current_path = ?1",
                params![relative_path],
                |row| row.get(0),
            )
            .expect("doc id")
    }

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

    #[test]
    fn round_trips_a_compressed_version() {
        // A larger, repetitive body exercises the compression path (the codec
        // only stores compressed when it actually shrinks the bytes), and must
        // come back byte-for-byte — and at its uncompressed size.
        let (_dir, store, vault_id) = store_with_doc();
        let body = "The quick brown fox jumps over the lazy dog.\n".repeat(500);
        store
            .record_document_written(vault_id, "note.md", &body, 10, body.len() as u64)
            .expect("write");

        let versions = store
            .list_document_versions(vault_id, "note.md", Some(&content_hash(&body)), 10)
            .expect("list");
        assert_eq!(versions.len(), 1);
        // Size reported is the uncompressed length, not the stored blob length.
        assert_eq!(versions[0].size_bytes, body.len() as i64);
        assert_eq!(
            store
                .document_version_content(vault_id, "note.md", &versions[0].revision_id)
                .expect("content"),
            body
        );
    }

    #[test]
    fn reads_legacy_uncompressed_rows_without_codec_metadata() {
        // Rows written before compression existed are raw bytes with codec
        // defaulted to 0 and a null uncompressed_size. They must still read back
        // and report the right (uncompressed) size via the length() fallback.
        let (_dir, store, vault_id) = store_with_doc();
        store
            .record_document_written(vault_id, "note.md", "legacy body", 10, 11)
            .expect("write");
        let revision_id = store
            .list_document_versions(vault_id, "note.md", None, 1)
            .expect("list")[0]
            .revision_id
            .clone();

        // Rewrite that snapshot the pre-compression way: raw bytes, codec = raw,
        // null uncompressed_size (the column didn't exist when it was written).
        let connection = store.vault_connection(vault_id).expect("connection");
        connection
            .execute(
                "update document_snapshots
                 set compressed_text = ?1, codec = 0, uncompressed_size = null
                 where revision_id = ?2",
                params![b"legacy body".to_vec(), revision_id],
            )
            .expect("simulate legacy row");

        let versions = store
            .list_document_versions(vault_id, "note.md", Some(&content_hash("legacy body")), 10)
            .expect("list");
        assert_eq!(versions.len(), 1);
        // Size falls back to the raw blob length when uncompressed_size is null.
        assert_eq!(versions[0].size_bytes, "legacy body".len() as i64);
        assert_eq!(
            store
                .document_version_content(vault_id, "note.md", &revision_id)
                .expect("content"),
            "legacy body"
        );
    }

    #[test]
    fn pruning_removes_revision_and_transaction_rows_not_just_blobs() {
        let (_dir, store, vault_id) = store_with_doc();

        // An early edit recorded as a transaction (so a `transactions` row
        // exists) — it should be pruned whole once it ages out, taking its
        // revision and transaction rows with it, not just its blob.
        store
            .record_document_written(vault_id, "note.md", "base", 1, 4)
            .expect("v0");
        store
            .record_document_transaction(
                vault_id,
                "note.md",
                DocumentEdit {
                    base_text: "base",
                    resulting_text: "base!",
                    changes: vec![DocumentTextChange {
                        range: SourceRange { start: 4, end: 4 },
                        text: "!".to_owned(),
                    }],
                },
                2,
                5,
            )
            .expect("tx edit");

        // Bury those old revisions well past the retention bound.
        let writes = SNAPSHOT_RETENTION_LIMIT + 5;
        for index in 0..writes {
            let body = format!("body {index}");
            store
                .record_document_written(
                    vault_id,
                    "note.md",
                    &body,
                    100 + index as i64,
                    body.len() as u64,
                )
                .expect("write");
        }

        let doc_id = doc_id_for(&store, vault_id, "note.md");
        // ~57 revisions were written; metadata rows are bounded to the newest N,
        // not just the blobs — the nuance this addresses.
        assert_eq!(
            count_for_doc(&store, vault_id, "document_revisions", &doc_id),
            SNAPSHOT_RETENTION_LIMIT as i64
        );
        assert_eq!(
            count_for_doc(&store, vault_id, "document_snapshots", &doc_id),
            SNAPSHOT_RETENTION_LIMIT as i64
        );
        // The lone transaction row belonged to a now-pruned old revision.
        assert_eq!(count_for_doc(&store, vault_id, "transactions", &doc_id), 0);

        // The current version is still restorable after the whole-unit pruning.
        let latest_body = format!("body {}", writes - 1);
        let latest = store
            .list_document_versions(vault_id, "note.md", Some(&content_hash(&latest_body)), 1)
            .expect("list latest");
        assert!(latest[0].is_current);
        assert_eq!(
            store
                .document_version_content(vault_id, "note.md", &latest[0].revision_id)
                .expect("restore latest"),
            latest_body
        );
    }

    #[test]
    fn prunes_old_versions_but_keeps_latest_and_llm_referenced() {
        let (_dir, store, vault_id) = store_with_doc();

        // v1 — record it, capture its revision, then point an LLM thread at it.
        // The audit-trail reference must survive pruning no matter how old v1
        // gets.
        store
            .record_document_written(vault_id, "note.md", "version 1", 1, 9)
            .expect("write v1");
        let v1 = store
            .list_document_versions(vault_id, "note.md", None, 1)
            .expect("list v1")[0]
            .revision_id
            .clone();
        store
            .record_llm_thread(LlmThreadRecordRequest {
                context_items: vec![LlmContextSnapshotRequest {
                    anchor: None,
                    file_path: "note.md".to_owned(),
                    kind: "file".to_owned(),
                    selected_text_snapshot: None,
                    source_comment_id: None,
                    source_range: None,
                    surrounding_context_snapshot: None,
                }],
                prompt: "Summarize this note".to_owned(),
                workspace_id: vault_id.to_owned(),
            })
            .expect("reference v1 from an LLM thread");

        // v2 — an ordinary version with no protection; it should be pruned away.
        store
            .record_document_written(vault_id, "note.md", "version 2", 2, 9)
            .expect("write v2");
        let v2 = store
            .list_document_versions(vault_id, "note.md", None, 1)
            .expect("list v2")[0]
            .revision_id
            .clone();

        // Write well past the retention bound so v1 and v2 fall out of the
        // newest-N window.
        let filler = SNAPSHOT_RETENTION_LIMIT + 5;
        for index in 0..filler {
            let body = format!("filler version {index}");
            store
                .record_document_written(
                    vault_id,
                    "note.md",
                    &body,
                    100 + index as i64,
                    body.len() as u64,
                )
                .expect("write filler");
        }

        // The list is the newest N snapshots plus the one protected (referenced)
        // older revision — never the full ~57 written.
        let versions = store
            .list_document_versions(vault_id, "note.md", None, 1000)
            .expect("list all");
        assert_eq!(versions.len(), SNAPSHOT_RETENTION_LIMIT + 1);

        // The current (latest) version is restorable and flagged current.
        let latest_body = format!("filler version {}", filler - 1);
        let latest = store
            .list_document_versions(vault_id, "note.md", Some(&content_hash(&latest_body)), 1)
            .expect("list latest");
        assert!(latest[0].is_current);
        assert_eq!(
            store
                .document_version_content(vault_id, "note.md", &latest[0].revision_id)
                .expect("restore latest"),
            latest_body
        );

        // The LLM-referenced v1 survived and still restores.
        assert_eq!(
            store
                .document_version_content(vault_id, "note.md", &v1)
                .expect("referenced version survived pruning"),
            "version 1"
        );

        // The unprotected, older v2 was pruned — its content is gone.
        assert!(
            store
                .document_version_content(vault_id, "note.md", &v2)
                .is_err(),
            "an old, unreferenced version should be pruned"
        );
    }
}
