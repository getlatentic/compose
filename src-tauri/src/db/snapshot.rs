//! Storage codec + retention policy for document-history snapshot blobs.
//!
//! A *snapshot* is the full content of one document version. They accumulate on
//! every write-capable run — the pre-run baseline and the post-run apply both
//! record one — so without bounds a long-lived vault's `vault.db` grows without
//! limit (the old "hardening backlog" item this module retires). Two mechanisms
//! keep that in check, both living here so the rest of `db` stays free of
//! compression details:
//!
//! - **Compression** — blobs are deflate-compressed on write and inflated on
//!   read ([`encode_snapshot`] / [`decode_snapshot`]). Each row carries a
//!   `codec` tag so it is self-describing: rows written before compression
//!   existed, and rows that don't compress smaller (tiny markdown files), are
//!   stored raw and read back unchanged. The `content_hash` is always computed
//!   over the *uncompressed* bytes — it is compared against live-file hashes
//!   elsewhere ([`super::MetadataStore::current_document_hash`],
//!   [`super::MetadataStore::unbaselined_paths`]) — so compression is invisible
//!   to every caller.
//! - **Retention** — [`ensure_snapshot_exists`] prunes after each insert so a
//!   document keeps only its newest [`SNAPSHOT_RETENTION_LIMIT`] revisions,
//!   never dropping the document's latest revision or any revision the LLM audit
//!   trail (`llm_context_items`) references. Pruning removes the *whole* stale
//!   unit — snapshot blob, `transactions` row, and `document_revisions` row — so
//!   per-revision metadata rows stay bounded too, not just the blobs.

use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::collections::HashSet;
use std::io::{Read, Write};
use uuid::Uuid;

/// Codec tag stored in `document_snapshots.codec` so each blob is
/// self-describing. `RAW` covers both pre-compression rows (legacy DBs default
/// the column to it) and content that didn't shrink under compression.
pub(super) const CODEC_RAW: i64 = 0;
pub(super) const CODEC_ZLIB: i64 = 1;

/// Newest revisions to keep per document. Matches the version-history UI's
/// default page size (the `workspace_list_versions` limit), so the list never
/// surfaces a version that pruning has already made unrestorable. Protected
/// revisions (the latest + any LLM-referenced) are retained on top of this.
pub(super) const SNAPSHOT_RETENTION_LIMIT: usize = 50;

/// Compress `content` for storage, returning `(blob, codec)`. Falls back to the
/// raw bytes (and [`CODEC_RAW`]) when compression wouldn't shrink them — tiny
/// markdown files, already-compressed payloads — so a stored snapshot is never
/// larger than its content.
pub(super) fn encode_snapshot(content: &[u8]) -> (Vec<u8>, i64) {
    match deflate(content) {
        Ok(compressed) if compressed.len() < content.len() => (compressed, CODEC_ZLIB),
        _ => (content.to_vec(), CODEC_RAW),
    }
}

/// Recover the original bytes of a stored snapshot blob, dispatching on its
/// `codec`. The inverse of [`encode_snapshot`].
pub(super) fn decode_snapshot(blob: &[u8], codec: i64) -> Result<Vec<u8>, String> {
    match codec {
        CODEC_RAW => Ok(blob.to_vec()),
        CODEC_ZLIB => {
            inflate(blob).map_err(|error| format!("could not decompress stored version: {error}"))
        }
        other => Err(format!("stored version has an unknown codec ({other})")),
    }
}

fn deflate(bytes: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes)?;
    encoder.finish()
}

fn inflate(blob: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut decoder = ZlibDecoder::new(blob);
    let mut bytes = Vec::new();
    decoder.read_to_end(&mut bytes)?;
    Ok(bytes)
}

/// Insert a content snapshot for `revision_id` unless one already exists, then
/// prune the document's history to the retention bound. Snapshots are addressed
/// by revision, so this stays idempotent across repeated baseline passes over
/// an unchanged document. The blob is compressed; `content_hash` is the hash of
/// the *uncompressed* `content` the caller already computed.
pub(super) fn ensure_snapshot_exists(
    transaction: &Transaction<'_>,
    doc_id: &str,
    revision_id: &str,
    content_hash: &str,
    content: &[u8],
    now: i64,
) -> rusqlite::Result<()> {
    let exists = transaction
        .query_row(
            "select 1 from document_snapshots where revision_id = ?1 limit 1",
            params![revision_id],
            |_row| Ok(()),
        )
        .optional()?
        .is_some();
    if exists {
        return Ok(());
    }
    let (blob, codec) = encode_snapshot(content);
    transaction.execute(
        "insert into document_snapshots
         (snapshot_id, doc_id, revision_id, content_hash, compressed_text, codec, uncompressed_size, created_at)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            Uuid::new_v4().to_string(),
            doc_id,
            revision_id,
            content_hash,
            blob,
            codec,
            content.len() as i64,
            now,
        ],
    )?;
    prune_document_history(transaction, doc_id)?;
    Ok(())
}

/// Keep a document's history bounded: retain the newest
/// [`SNAPSHOT_RETENTION_LIMIT`] revisions plus any that must never be dropped —
/// the document's latest revision, and every revision referenced by the LLM
/// audit trail — and delete the rest **whole**: the snapshot blob, the
/// `transactions` row, and the `document_revisions` row itself. (Pruning only
/// the blob would still leave per-revision metadata rows growing without bound.)
///
/// References that would dangle after a row is gone are cleaned up rather than
/// left pointing at nothing: a surviving revision's `parent_revision_id` and a
/// surviving transaction's `base_revision_id` are nulled when their target was
/// pruned. Those pointers are only ever read for the *latest* revision (always
/// retained), so this is defensive consistency, not a correctness fix.
fn prune_document_history(
    transaction: &Transaction<'_>,
    doc_id: &str,
) -> rusqlite::Result<()> {
    let protected = protected_revisions(transaction, doc_id)?;

    // Every revision for this doc, newest first — including snapshot-less
    // (sync-only) revisions, so those metadata rows are bounded too.
    let revisions = {
        let mut statement = transaction.prepare(
            "select revision_id
             from document_revisions
             where doc_id = ?1
             order by created_at desc, revision_id desc",
        )?;
        let revisions = statement
            .query_map(params![doc_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<String>>>()?;
        revisions
    };

    let mut pruned_any = false;
    for (position, revision_id) in revisions.iter().enumerate() {
        let within_budget = position < SNAPSHOT_RETENTION_LIMIT;
        if within_budget || protected.contains(revision_id) {
            continue;
        }
        transaction.execute(
            "delete from document_snapshots where doc_id = ?1 and revision_id = ?2",
            params![doc_id, revision_id],
        )?;
        transaction.execute(
            "delete from transactions where doc_id = ?1 and resulting_revision_id = ?2",
            params![doc_id, revision_id],
        )?;
        transaction.execute(
            "delete from document_revisions where revision_id = ?1",
            params![revision_id],
        )?;
        pruned_any = true;
    }

    if pruned_any {
        clear_dangling_revision_pointers(transaction, doc_id)?;
    }
    Ok(())
}

/// Null out same-document pointers whose target revision was just pruned, so no
/// row references a `document_revisions` row that no longer exists.
fn clear_dangling_revision_pointers(
    transaction: &Transaction<'_>,
    doc_id: &str,
) -> rusqlite::Result<()> {
    transaction.execute(
        "update document_revisions
         set parent_revision_id = null
         where doc_id = ?1 and parent_revision_id is not null
           and parent_revision_id not in
             (select revision_id from document_revisions where doc_id = ?1)",
        params![doc_id],
    )?;
    transaction.execute(
        "update transactions
         set base_revision_id = null
         where doc_id = ?1 and base_revision_id is not null
           and base_revision_id not in
             (select revision_id from document_revisions where doc_id = ?1)",
        params![doc_id],
    )?;
    Ok(())
}

/// Revisions whose snapshot must survive pruning regardless of age: the
/// document's latest revision (the restore-to-current anchor, and the marker
/// [`super::MetadataStore::unbaselined_paths`] reads to decide a file is already
/// baselined) and any revision the LLM audit trail (`llm_context_items`) points
/// at.
fn protected_revisions(
    transaction: &Transaction<'_>,
    doc_id: &str,
) -> rusqlite::Result<HashSet<String>> {
    let mut protected = HashSet::new();
    if let Some(latest) = super::latest_revision_id_for_doc(transaction, doc_id)? {
        protected.insert(latest);
    }
    let mut statement = transaction.prepare(
        "select distinct document_revision_id
         from llm_context_items
         where doc_id = ?1 and document_revision_id is not null",
    )?;
    let rows = statement.query_map(params![doc_id], |row| row.get::<_, String>(0))?;
    for revision_id in rows {
        protected.insert(revision_id?);
    }
    Ok(protected)
}

/// Bring an existing `document_snapshots` table up to the compression schema:
/// the `codec` tag and the `uncompressed_size` of the original content. Fresh
/// DBs get these from `create table`; this adds them in place for DBs created
/// before compression existed (legacy rows are raw, so `codec` defaults to
/// [`CODEC_RAW`] and `uncompressed_size` stays null — read back as the blob
/// length). Mirrors the `ensure_conversation_columns` migration pattern.
pub(super) fn ensure_snapshot_columns(connection: &Connection) -> Result<(), String> {
    let mut existing = HashSet::new();
    {
        let mut statement = connection
            .prepare("pragma table_info(document_snapshots)")
            .map_err(|error| format!("could not inspect document_snapshots schema: {error}"))?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| format!("could not read document_snapshots schema: {error}"))?;
        for name in rows {
            existing
                .insert(name.map_err(|error| format!("could not decode column name: {error}"))?);
        }
    }

    for (column, ddl) in [
        (
            "codec",
            "alter table document_snapshots add column codec integer not null default 0",
        ),
        (
            "uncompressed_size",
            "alter table document_snapshots add column uncompressed_size integer",
        ),
    ] {
        if !existing.contains(column) {
            connection
                .execute(ddl, [])
                .map_err(|error| format!("could not add document_snapshots.{column}: {error}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compresses_and_round_trips_repetitive_text() {
        let content = "All work and no play makes Jack a dull boy.\n".repeat(200);
        let bytes = content.as_bytes();
        let (blob, codec) = encode_snapshot(bytes);
        assert_eq!(codec, CODEC_ZLIB);
        assert!(
            blob.len() < bytes.len(),
            "repetitive text should compress smaller ({} >= {})",
            blob.len(),
            bytes.len()
        );
        assert_eq!(decode_snapshot(&blob, codec).expect("decode"), bytes);
    }

    #[test]
    fn stores_tiny_or_incompressible_content_raw() {
        // A handful of bytes can't beat the zlib frame overhead, so the codec
        // keeps them raw rather than store something larger than the content.
        let bytes = b"hi";
        let (blob, codec) = encode_snapshot(bytes);
        assert_eq!(codec, CODEC_RAW);
        assert_eq!(blob, bytes);
        assert_eq!(decode_snapshot(&blob, codec).expect("decode"), bytes);
    }

    #[test]
    fn round_trips_empty_and_unicode_content() {
        for content in ["", &"héllo — 世界 — 🌍\n".repeat(100)] {
            let bytes = content.as_bytes();
            let (blob, codec) = encode_snapshot(bytes);
            assert_eq!(decode_snapshot(&blob, codec).expect("decode"), bytes);
        }
    }

    #[test]
    fn decode_rejects_an_unknown_codec() {
        assert!(decode_snapshot(b"whatever", 99).is_err());
    }
}
