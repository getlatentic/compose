use rusqlite::{params, types::Type, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

#[derive(Default)]
pub struct MetadataStore {
    paths: Mutex<Option<MetadataPaths>>,
}

#[derive(Debug, Clone)]
struct MetadataPaths {
    app_db_path: PathBuf,
    vaults_dir: PathBuf,
    trash_dir: PathBuf,
}

// The single coordinate type lives in the shared `workspace-index` core
// crate (so the index/search logic can compile to WASM); re-exported here
// so `crate::db::SourceRange` and every metadata DTO below keep using it.
pub use workspace_index::SourceRange;

// Conversation persistence (the chat history layer) lives in its own module
// — the OPEN / ARCHIVE / DELETE lifecycle, the history list, and the
// per-conversation actions. Types are re-exported so `crate::db::Conversation*`
// keeps resolving; the Tauri commands are referenced via `db::conversations::*`.
pub mod conversations;
pub use conversations::{ConversationMessageRecord, ConversationSnapshot, ConversationSummary};

// Git-free version history: list the snapshots recorded for a document and
// read a chosen prior version back. Backs the "restore previous version"
// UI. Lives in its own module so this file stays focused on persistence
// primitives; the queries reuse the private `MetadataStore::vault_connection`
// (a descendant module can see its ancestor's private items).
pub mod history;
pub use history::{BaselineCandidate, DocumentVersion};

// Recoverable-trash bookkeeping: a row per soft-deleted file recording *when*
// it was trashed, so the retention sweep (`files::trash_sweep`) can purge old
// entries. Rows live in the global db keyed by `vault_id` (one sweep query
// covers every vault); the filesystem alone can't tell us the deletion time
// because a rename preserves the file's content-mtime, not the moment it was
// deleted. Like `history`, this submodule reuses the private `app_connection`.
pub mod trash;
pub use trash::TrashEntry;

// Snapshot blob storage: compression codec (deflate, with a self-describing
// `codec` tag and a raw fallback) and the retention policy that bounds a
// document's history. Kept out of this file so the persistence primitives here
// stay free of compression details. Private to the `db` module.
mod snapshot;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommentAnchor {
    pub prefix: String,
    pub range: SourceRange,
    pub resolution: String,
    pub selected_text: String,
    pub suffix: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentTextChange {
    pub range: SourceRange,
    pub text: String,
}

/// One document edit handed to [`MetadataStore::record_document_transaction`]:
/// the text before and after the edit, plus the change-list that transforms one
/// into the other. The three always travel together, so they are bundled rather
/// than passed as separate arguments.
pub struct DocumentEdit<'a> {
    pub base_text: &'a str,
    pub resulting_text: &'a str,
    pub changes: Vec<DocumentTextChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCommentThread {
    pub anchor: CommentAnchor,
    pub body: String,
    pub created_at: i64,
    pub file_path: String,
    pub id: String,
    pub status: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmContextSnapshotRequest {
    pub anchor: Option<CommentAnchor>,
    pub file_path: String,
    pub kind: String,
    pub selected_text_snapshot: Option<String>,
    pub source_comment_id: Option<String>,
    pub source_range: Option<SourceRange>,
    pub surrounding_context_snapshot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmThreadRecordRequest {
    pub context_items: Vec<LlmContextSnapshotRequest>,
    pub prompt: String,
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmThreadRecordResult {
    pub llm_thread_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmMessageAppendRequest {
    pub body: String,
    pub llm_thread_id: String,
    pub role: String,
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmThreadLoadRequest {
    pub llm_thread_id: String,
    pub workspace_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmThreadSnapshot {
    pub context_items: Vec<LlmContextSnapshotRecord>,
    pub created_at: i64,
    pub llm_thread_id: String,
    pub messages: Vec<LlmMessageRecord>,
    pub source_id: Option<String>,
    pub source_kind: String,
    pub title: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmMessageRecord {
    pub body: String,
    pub created_at: i64,
    pub llm_message_id: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmContextSnapshotRecord {
    pub anchor: Option<CommentAnchor>,
    pub context_item_id: String,
    pub created_at: i64,
    pub current_path: Option<String>,
    pub doc_id: Option<String>,
    pub document_revision_id: Option<String>,
    pub selected_text_snapshot: Option<String>,
    pub source_range: Option<SourceRange>,
    pub surrounding_context_snapshot: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentInventoryEntry {
    pub content_hash: String,
    pub last_seen_mtime: i64,
    pub last_seen_size: u64,
    pub relative_path: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchIndexRecords {
    pub backlinks: Vec<SearchBacklinkRecord>,
    pub frontmatter: Vec<SearchFrontmatterRecord>,
    pub graph_edges: Vec<SearchGraphEdgeRecord>,
    pub tags: Vec<SearchTagRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchBacklinkRecord {
    pub kind: String,
    pub label: String,
    pub source_doc_id: String,
    pub source_path: String,
    pub source_range: SourceRange,
    pub target_doc_id: Option<String>,
    pub target_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchFrontmatterRecord {
    pub doc_id: String,
    pub key: String,
    pub path: String,
    pub source_range: SourceRange,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchGraphEdgeRecord {
    pub from_doc_id: String,
    pub from_path: String,
    pub kind: String,
    pub source_range: SourceRange,
    pub to_doc_id: Option<String>,
    pub to_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchTagRecord {
    pub doc_id: String,
    pub kind: String,
    pub path: String,
    pub source_range: SourceRange,
    pub tag: String,
}

impl MetadataStore {
    pub fn init_from_app(&self, app: &AppHandle) -> Result<(), String> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("app data dir unavailable: {error}"))?;
        self.init_from_dir(&data_dir)
    }

    pub fn init_from_dir(&self, data_dir: &Path) -> Result<(), String> {
        std::fs::create_dir_all(data_dir)
            .map_err(|error| format!("could not create app data dir: {error}"))?;
        let app_db_path = data_dir.join("app.db");
        let vaults_dir = data_dir.join("vaults");
        std::fs::create_dir_all(&vaults_dir)
            .map_err(|error| format!("could not create vault metadata dir: {error}"))?;
        // Recoverable trash for soft-deleted files — outside any workspace so
        // it never syncs or clutters the user's folder. Created lazily on the
        // first delete (see `MetadataStore::trash_root`).
        let trash_dir = data_dir.join("trash");

        migrate_global_database(&app_db_path)?;
        *self
            .paths
            .lock()
            .map_err(|_| "metadata store lock was poisoned".to_owned())? = Some(MetadataPaths {
            app_db_path,
            vaults_dir,
            trash_dir,
        });
        Ok(())
    }

    /// Absolute path to the recoverable-trash root (`<app data>/trash`),
    /// created if missing. Soft-deleted files are moved here rather than
    /// hard-deleted, so a deletion is always reversible.
    pub fn trash_root(&self) -> Result<PathBuf, String> {
        let trash_dir = self.paths()?.trash_dir;
        std::fs::create_dir_all(&trash_dir)
            .map_err(|error| format!("could not create trash dir: {error}"))?;
        Ok(trash_dir)
    }

    pub fn ensure_vault(
        &self,
        vault_id: &str,
        display_name: &str,
        root_path: &Path,
    ) -> Result<(), String> {
        validate_storage_id(vault_id, "vault id")?;
        let now = now_ms();
        let root_path = root_path.to_string_lossy().to_string();
        let app_connection = self.app_connection()?;
        app_connection
            .execute(
                "insert into vaults
                 (vault_id, display_name, current_root_path, root_fingerprint, created_at, last_opened_at, deleted_at)
                 values (?1, ?2, ?3, null, ?4, ?4, null)
                 on conflict(vault_id) do update set
                   display_name = excluded.display_name,
                   current_root_path = excluded.current_root_path,
                   last_opened_at = excluded.last_opened_at,
                   deleted_at = null",
                params![vault_id, display_name, root_path, now],
            )
            .map_err(|error| format!("could not upsert vault registry: {error}"))?;
        app_connection
            .execute(
                "insert into vault_path_history
                 (vault_id, root_path, first_seen_at, last_seen_at)
                 values (?1, ?2, ?3, ?3)
                 on conflict(vault_id, root_path) do update set
                   last_seen_at = excluded.last_seen_at",
                params![vault_id, root_path, now],
            )
            .map_err(|error| format!("could not upsert vault path history: {error}"))?;

        let vault_db_path = self.vault_db_path(vault_id)?;
        migrate_vault_database(&vault_db_path)
    }

    pub fn sync_documents(
        &self,
        vault_id: &str,
        entries: Vec<DocumentInventoryEntry>,
    ) -> Result<(), String> {
        self.sync_documents_retaining(vault_id, entries, &[])
    }

    /// Sync the scanned inventory, but treat `retained_paths` as still present
    /// even though they carry no fresh inventory row this pass.
    ///
    /// These are files the scan saw on disk yet couldn't read (an iCloud note
    /// that wouldn't materialize, a permission glitch). Their existing metadata
    /// row is left exactly as it was — neither re-hashed nor marked deleted —
    /// so a transient read failure never erases a real document's search data.
    pub fn sync_documents_retaining(
        &self,
        vault_id: &str,
        entries: Vec<DocumentInventoryEntry>,
        retained_paths: &[String],
    ) -> Result<(), String> {
        validate_storage_id(vault_id, "vault id")?;
        let now = now_ms();
        let mut connection = self.vault_connection(vault_id)?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("could not start document sync transaction: {error}"))?;
        let mut seen_paths = Vec::with_capacity(entries.len() + retained_paths.len());

        for entry in entries {
            validate_relative_metadata_path(&entry.relative_path)?;
            seen_paths.push(entry.relative_path.clone());
            upsert_document(&transaction, &entry, None, None, now)
                .map_err(|error| format!("could not upsert document metadata: {error}"))?;
        }
        seen_paths.extend(retained_paths.iter().cloned());

        mark_missing_documents_deleted(&transaction, &seen_paths, now)
            .map_err(|error| format!("could not mark missing documents deleted: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("could not commit document sync: {error}"))?;
        Ok(())
    }

    pub fn record_document_written(
        &self,
        vault_id: &str,
        relative_path: &str,
        content: &str,
        last_seen_mtime: i64,
        last_seen_size: u64,
    ) -> Result<(), String> {
        validate_storage_id(vault_id, "vault id")?;
        validate_relative_metadata_path(relative_path)?;
        let now = now_ms();
        let entry = DocumentInventoryEntry {
            content_hash: content_hash(content),
            last_seen_mtime,
            last_seen_size,
            relative_path: relative_path.to_owned(),
            title: title_from_content_or_path(content, relative_path),
        };
        let mut connection = self.vault_connection(vault_id)?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("could not start document write transaction: {error}"))?;
        upsert_document(&transaction, &entry, Some(content.as_bytes()), None, now)
            .map_err(|error| format!("could not record document write: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("could not commit document write metadata: {error}"))?;
        Ok(())
    }

    pub fn record_document_transaction(
        &self,
        vault_id: &str,
        relative_path: &str,
        edit: DocumentEdit<'_>,
        last_seen_mtime: i64,
        last_seen_size: u64,
    ) -> Result<(), String> {
        if edit.changes.is_empty() {
            return self.record_document_written(
                vault_id,
                relative_path,
                edit.resulting_text,
                last_seen_mtime,
                last_seen_size,
            );
        }

        validate_storage_id(vault_id, "vault id")?;
        validate_relative_metadata_path(relative_path)?;
        let (_computed_text, inverse_changes) =
            inverse_changes_for_transaction(edit.base_text, edit.resulting_text, &edit.changes)?;
        let now = now_ms();
        let transaction_id = Uuid::new_v4().to_string();
        let entry = DocumentInventoryEntry {
            content_hash: content_hash(edit.resulting_text),
            last_seen_mtime,
            last_seen_size,
            relative_path: relative_path.to_owned(),
            title: title_from_content_or_path(edit.resulting_text, relative_path),
        };
        let mut connection = self.vault_connection(vault_id)?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("could not start document transaction write: {error}"))?;
        let (doc_id, resulting_revision_id) = upsert_document(
            &transaction,
            &entry,
            Some(edit.resulting_text.as_bytes()),
            Some(&transaction_id),
            now,
        )
        .map_err(|error| format!("could not record document transaction revision: {error}"))?;
        let base_revision_id = parent_revision_for(&transaction, &resulting_revision_id)
            .map_err(|error| format!("could not resolve base revision: {error}"))?;
        let changes_json = serde_json::to_string(&edit.changes)
            .map_err(|error| format!("could not encode transaction changes: {error}"))?;
        let inverse_changes_json = serde_json::to_string(&inverse_changes)
            .map_err(|error| format!("could not encode inverse transaction changes: {error}"))?;
        transaction
            .execute(
                "insert into transactions
                 (transaction_id, doc_id, origin, base_revision_id, resulting_revision_id, changes_json, inverse_changes_json, created_at)
                 values (?1, ?2, 'local_edit', ?3, ?4, ?5, ?6, ?7)",
                params![
                    transaction_id,
                    doc_id,
                    base_revision_id,
                    resulting_revision_id,
                    changes_json,
                    inverse_changes_json,
                    now,
                ],
            )
            .map_err(|error| format!("could not insert document transaction: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("could not commit document transaction metadata: {error}"))?;
        Ok(())
    }

    pub fn rename_document(
        &self,
        vault_id: &str,
        from_relative: &str,
        to_relative: &str,
    ) -> Result<(), String> {
        validate_storage_id(vault_id, "vault id")?;
        validate_relative_metadata_path(from_relative)?;
        validate_relative_metadata_path(to_relative)?;
        let now = now_ms();
        let mut connection = self.vault_connection(vault_id)?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("could not start document rename transaction: {error}"))?;
        let doc_id = document_id_for_path(&transaction, from_relative)
            .map_err(|error| format!("could not find document metadata: {error}"))?
            .ok_or_else(|| format!("{from_relative} is not registered in document metadata"))?;
        transaction
            .execute(
                "update documents
                 set current_path = ?1, updated_at = ?2, deleted_at = null
                 where doc_id = ?3",
                params![to_relative, now, doc_id],
            )
            .map_err(|error| format!("could not rename document metadata: {error}"))?;
        upsert_document_path_history(&transaction, &doc_id, to_relative, now)
            .map_err(|error| format!("could not record document path history: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("could not commit document rename metadata: {error}"))?;
        Ok(())
    }

    pub fn mark_document_deleted(&self, vault_id: &str, relative_path: &str) -> Result<(), String> {
        validate_storage_id(vault_id, "vault id")?;
        validate_relative_metadata_path(relative_path)?;
        let now = now_ms();
        let connection = self.vault_connection(vault_id)?;
        connection
            .execute(
                "update documents
                 set deleted_at = ?1, updated_at = ?1
                 where current_path = ?2 and deleted_at is null",
                params![now, relative_path],
            )
            .map_err(|error| format!("could not mark document deleted: {error}"))?;
        Ok(())
    }

    pub fn load_comments(&self, workspace_id: &str) -> Result<Vec<WorkspaceCommentThread>, String> {
        validate_storage_id(workspace_id, "workspace id")?;
        let connection = self.vault_connection(workspace_id)?;
        let mut statement = connection
            .prepare(
                "select
                   ct.thread_id,
                   d.current_path,
                   coalesce(cm.body, ''),
                   ct.status,
                   ct.anchor_json,
                   ct.created_at,
                   ct.updated_at
                 from comment_threads ct
                 join documents d on d.doc_id = ct.doc_id
                 left join comment_messages cm
                   on cm.thread_id = ct.thread_id and cm.author_kind = 'local_user'
                 where d.deleted_at is null
                 order by ct.created_at asc, ct.thread_id asc",
            )
            .map_err(|error| format!("could not prepare comments query: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                let anchor_json: String = row.get(4)?;
                let anchor =
                    serde_json::from_str::<CommentAnchor>(&anchor_json).map_err(|error| {
                        rusqlite::Error::FromSqlConversionFailure(4, Type::Text, Box::new(error))
                    })?;
                Ok(WorkspaceCommentThread {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    body: row.get(2)?,
                    status: row.get(3)?,
                    anchor,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|error| format!("could not load comments: {error}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("could not decode comments: {error}"))
    }

    pub fn save_comments(
        &self,
        workspace_id: &str,
        comments: Vec<WorkspaceCommentThread>,
    ) -> Result<(), String> {
        validate_storage_id(workspace_id, "workspace id")?;
        let mut connection = self.vault_connection(workspace_id)?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("could not start metadata transaction: {error}"))?;

        transaction
            .execute(
                "delete from comment_messages
                 where thread_id in (
                   select thread_id from comment_threads
                   where doc_id in (select doc_id from documents)
                 )",
                [],
            )
            .map_err(|error| format!("could not replace comment messages: {error}"))?;
        transaction
            .execute(
                "delete from comment_threads
                 where doc_id in (select doc_id from documents)",
                [],
            )
            .map_err(|error| format!("could not replace comment threads: {error}"))?;

        for comment in comments {
            validate_comment(&comment)?;
            let doc_id = document_id_for_path(&transaction, &comment.file_path)
                .map_err(|error| format!("could not resolve comment document: {error}"))?
                .ok_or_else(|| {
                    format!(
                        "{} is not registered in document metadata; scan the workspace before saving comments",
                        comment.file_path
                    )
                })?;
            let anchor_json = serde_json::to_string(&comment.anchor)
                .map_err(|error| format!("could not encode comment anchor: {error}"))?;
            transaction
                .execute(
                    "insert into comment_threads
                     (thread_id, doc_id, status, anchor_json, selected_text, created_at, updated_at, resolved_at)
                     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, null)",
                    params![
                        comment.id,
                        doc_id,
                        comment.status,
                        anchor_json,
                        comment.anchor.selected_text,
                        comment.created_at,
                        comment.updated_at,
                    ],
                )
                .map_err(|error| format!("could not save comment thread: {error}"))?;
            transaction
                .execute(
                    "insert into comment_messages
                     (message_id, thread_id, author_kind, body, created_at)
                     values (?1, ?2, 'local_user', ?3, ?4)",
                    params![
                        format!("{}:local-user", comment.id),
                        comment.id,
                        comment.body,
                        comment.created_at,
                    ],
                )
                .map_err(|error| format!("could not save comment message: {error}"))?;
        }

        transaction
            .commit()
            .map_err(|error| format!("could not commit comments: {error}"))?;
        Ok(())
    }

    pub fn record_llm_thread(
        &self,
        request: LlmThreadRecordRequest,
    ) -> Result<LlmThreadRecordResult, String> {
        validate_storage_id(&request.workspace_id, "workspace id")?;
        let prompt = request.prompt.trim();
        if prompt.is_empty() {
            return Err("LLM prompt cannot be blank".to_owned());
        }
        for item in &request.context_items {
            validate_llm_context_item(item)?;
        }

        let now = now_ms();
        let mut connection = self.vault_connection(&request.workspace_id)?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("could not start LLM metadata transaction: {error}"))?;
        let llm_thread_id = Uuid::new_v4().to_string();
        let source_kind = source_kind_for_context_items(&request.context_items);
        let source_id = request
            .context_items
            .iter()
            .find_map(|item| item.source_comment_id.clone());

        transaction
            .execute(
                "insert into llm_threads
                 (llm_thread_id, title, source_kind, source_id, created_at, updated_at)
                 values (?1, ?2, ?3, ?4, ?5, ?5)",
                params![
                    llm_thread_id,
                    title_from_prompt(prompt),
                    source_kind,
                    source_id,
                    now,
                ],
            )
            .map_err(|error| format!("could not save LLM thread: {error}"))?;
        transaction
            .execute(
                "insert into llm_messages
                 (llm_message_id, llm_thread_id, role, body, created_at)
                 values (?1, ?2, 'user', ?3, ?4)",
                params![Uuid::new_v4().to_string(), llm_thread_id, prompt, now],
            )
            .map_err(|error| format!("could not save LLM user message: {error}"))?;

        for item in request.context_items {
            // The document may not be registered yet — the search index builds in
            // the background (and may not have run when the first message is sent),
            // or the file was only scanned, never edited in Compose. The context's
            // value to the agent is the snapshot + path (carried in the prompt), not
            // this version linkage — so store what resolves and leave doc_id /
            // revision null rather than failing the whole send.
            let doc_id = document_id_for_path(&transaction, &item.file_path)
                .map_err(|error| format!("could not resolve LLM context document: {error}"))?;
            let revision_id = match doc_id.as_deref() {
                Some(id) => latest_revision_id_for_doc(&transaction, id)
                    .map_err(|error| format!("could not resolve document revision: {error}"))?,
                None => None,
            };
            let source_range_json = optional_json(&item.source_range)?;
            let anchor_json = optional_json(&item.anchor)?;

            transaction
                .execute(
                    "insert into llm_context_items
                     (context_item_id, llm_thread_id, doc_id, source_range_json, anchor_json,
                      selected_text_snapshot, surrounding_context_snapshot, document_revision_id, created_at)
                     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        Uuid::new_v4().to_string(),
                        llm_thread_id,
                        doc_id,
                        source_range_json,
                        anchor_json,
                        item.selected_text_snapshot,
                        item.surrounding_context_snapshot,
                        revision_id,
                        now,
                    ],
                )
                .map_err(|error| format!("could not save LLM context item: {error}"))?;
        }

        transaction
            .commit()
            .map_err(|error| format!("could not commit LLM metadata: {error}"))?;
        Ok(LlmThreadRecordResult { llm_thread_id })
    }

    pub fn append_llm_message(&self, request: LlmMessageAppendRequest) -> Result<(), String> {
        validate_storage_id(&request.workspace_id, "workspace id")?;
        validate_storage_id(&request.llm_thread_id, "LLM thread id")?;
        validate_llm_message_role(&request.role)?;
        let body = request.body.trim();
        if body.is_empty() {
            return Err("LLM message body cannot be blank".to_owned());
        }

        let now = now_ms();
        let mut connection = self.vault_connection(&request.workspace_id)?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("could not start LLM message transaction: {error}"))?;
        let exists = transaction
            .query_row(
                "select 1 from llm_threads where llm_thread_id = ?1",
                params![request.llm_thread_id],
                |_row| Ok(()),
            )
            .optional()
            .map_err(|error| format!("could not load LLM thread: {error}"))?
            .is_some();
        if !exists {
            return Err("LLM thread is not registered".to_owned());
        }

        transaction
            .execute(
                "insert into llm_messages
                 (llm_message_id, llm_thread_id, role, body, created_at)
                 values (?1, ?2, ?3, ?4, ?5)",
                params![
                    Uuid::new_v4().to_string(),
                    request.llm_thread_id,
                    request.role,
                    body,
                    now,
                ],
            )
            .map_err(|error| format!("could not append LLM message: {error}"))?;
        transaction
            .execute(
                "update llm_threads
                 set updated_at = ?1
                 where llm_thread_id = ?2",
                params![now, request.llm_thread_id],
            )
            .map_err(|error| format!("could not update LLM thread timestamp: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("could not commit LLM message: {error}"))?;
        Ok(())
    }

    pub fn load_llm_thread(
        &self,
        request: LlmThreadLoadRequest,
    ) -> Result<LlmThreadSnapshot, String> {
        validate_storage_id(&request.workspace_id, "workspace id")?;
        validate_storage_id(&request.llm_thread_id, "LLM thread id")?;
        let connection = self.vault_connection(&request.workspace_id)?;
        let (title, source_kind, source_id, created_at, updated_at) = connection
            .query_row(
                "select title, source_kind, source_id, created_at, updated_at
                 from llm_threads
                 where llm_thread_id = ?1",
                params![request.llm_thread_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("could not load LLM thread: {error}"))?
            .ok_or_else(|| "LLM thread is not registered".to_owned())?;

        let messages = load_llm_messages(&connection, &request.llm_thread_id)?;
        let context_items = load_llm_context_items(&connection, &request.llm_thread_id)?;

        Ok(LlmThreadSnapshot {
            context_items,
            created_at,
            llm_thread_id: request.llm_thread_id,
            messages,
            source_id,
            source_kind,
            title,
            updated_at,
        })
    }

    pub fn document_ids_by_path(&self, vault_id: &str) -> Result<HashMap<String, String>, String> {
        validate_storage_id(vault_id, "vault id")?;
        let connection = self.vault_connection(vault_id)?;
        let mut statement = connection
            .prepare(
                "select current_path, doc_id
                 from documents
                 where deleted_at is null",
            )
            .map_err(|error| format!("could not prepare document id query: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| format!("could not load document ids: {error}"))?;

        rows.collect::<Result<HashMap<_, _>, _>>()
            .map_err(|error| format!("could not decode document ids: {error}"))
    }

    pub fn replace_search_index_records(
        &self,
        vault_id: &str,
        records: SearchIndexRecords,
    ) -> Result<(), String> {
        validate_storage_id(vault_id, "vault id")?;
        validate_search_index_records(&records)?;
        let now = now_ms();
        let mut connection = self.vault_connection(vault_id)?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("could not start search index transaction: {error}"))?;

        transaction
            .execute("delete from search_backlinks", [])
            .map_err(|error| format!("could not clear backlinks index: {error}"))?;
        transaction
            .execute("delete from search_tags", [])
            .map_err(|error| format!("could not clear tags index: {error}"))?;
        transaction
            .execute("delete from search_frontmatter", [])
            .map_err(|error| format!("could not clear frontmatter index: {error}"))?;
        transaction
            .execute("delete from graph_edges", [])
            .map_err(|error| format!("could not clear graph edge index: {error}"))?;

        for backlink in records.backlinks {
            let source_range_json = serde_json::to_string(&backlink.source_range)
                .map_err(|error| format!("could not encode backlink range: {error}"))?;
            transaction
                .execute(
                    "insert into search_backlinks
                     (backlink_id, source_doc_id, source_path, target_doc_id, target_path,
                      link_kind, label, source_range_json, updated_at)
                     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        Uuid::new_v4().to_string(),
                        backlink.source_doc_id,
                        backlink.source_path,
                        backlink.target_doc_id,
                        backlink.target_path,
                        backlink.kind,
                        backlink.label,
                        source_range_json,
                        now,
                    ],
                )
                .map_err(|error| format!("could not insert backlink index: {error}"))?;
        }

        for tag in records.tags {
            let source_range_json = serde_json::to_string(&tag.source_range)
                .map_err(|error| format!("could not encode tag range: {error}"))?;
            transaction
                .execute(
                    "insert into search_tags
                     (tag_id, doc_id, path, tag, tag_kind, source_range_json, updated_at)
                     values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        Uuid::new_v4().to_string(),
                        tag.doc_id,
                        tag.path,
                        tag.tag,
                        tag.kind,
                        source_range_json,
                        now,
                    ],
                )
                .map_err(|error| format!("could not insert tag index: {error}"))?;
        }

        for frontmatter in records.frontmatter {
            let source_range_json = serde_json::to_string(&frontmatter.source_range)
                .map_err(|error| format!("could not encode frontmatter range: {error}"))?;
            transaction
                .execute(
                    "insert into search_frontmatter
                     (frontmatter_id, doc_id, path, key, value, source_range_json, updated_at)
                     values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        Uuid::new_v4().to_string(),
                        frontmatter.doc_id,
                        frontmatter.path,
                        frontmatter.key,
                        frontmatter.value,
                        source_range_json,
                        now,
                    ],
                )
                .map_err(|error| format!("could not insert frontmatter index: {error}"))?;
        }

        for edge in records.graph_edges {
            let source_range_json = serde_json::to_string(&edge.source_range)
                .map_err(|error| format!("could not encode graph edge range: {error}"))?;
            transaction
                .execute(
                    "insert into graph_edges
                     (edge_id, from_doc_id, from_path, to_doc_id, to_path, edge_kind,
                      source_range_json, updated_at)
                     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        Uuid::new_v4().to_string(),
                        edge.from_doc_id,
                        edge.from_path,
                        edge.to_doc_id,
                        edge.to_path,
                        edge.kind,
                        source_range_json,
                        now,
                    ],
                )
                .map_err(|error| format!("could not insert graph edge index: {error}"))?;
        }

        transaction
            .commit()
            .map_err(|error| format!("could not commit search index metadata: {error}"))?;
        Ok(())
    }

    fn app_connection(&self) -> Result<Connection, String> {
        let paths = self.paths()?;
        open_connection(&paths.app_db_path)
    }

    fn vault_connection(&self, vault_id: &str) -> Result<Connection, String> {
        let db_path = self.vault_db_path(vault_id)?;
        migrate_vault_database(&db_path)?;
        open_connection(&db_path)
    }

    fn vault_db_path(&self, vault_id: &str) -> Result<PathBuf, String> {
        validate_storage_id(vault_id, "vault id")?;
        let paths = self.paths()?;
        let vault_dir = paths.vaults_dir.join(vault_id);
        std::fs::create_dir_all(&vault_dir)
            .map_err(|error| format!("could not create vault metadata dir: {error}"))?;
        Ok(vault_dir.join("vault.db"))
    }

    fn paths(&self) -> Result<MetadataPaths, String> {
        self.paths
            .lock()
            .map_err(|_| "metadata store lock was poisoned".to_owned())?
            .clone()
            .ok_or_else(|| "metadata store is not initialized".to_owned())
    }
}

#[tauri::command(async)]
pub fn metadata_load_comments(
    workspace_id: String,
    store: State<'_, MetadataStore>,
) -> Result<Vec<WorkspaceCommentThread>, String> {
    store.load_comments(&workspace_id)
}

#[tauri::command(async)]
pub fn metadata_save_comments(
    workspace_id: String,
    comments: Vec<WorkspaceCommentThread>,
    store: State<'_, MetadataStore>,
) -> Result<(), String> {
    store.save_comments(&workspace_id, comments)
}

#[tauri::command(async)]
pub fn metadata_record_llm_thread(
    request: LlmThreadRecordRequest,
    store: State<'_, MetadataStore>,
) -> Result<LlmThreadRecordResult, String> {
    store.record_llm_thread(request)
}

#[tauri::command(async)]
pub fn metadata_append_llm_message(
    request: LlmMessageAppendRequest,
    store: State<'_, MetadataStore>,
) -> Result<(), String> {
    store.append_llm_message(request)
}

#[tauri::command(async)]
pub fn metadata_load_llm_thread(
    request: LlmThreadLoadRequest,
    store: State<'_, MetadataStore>,
) -> Result<LlmThreadSnapshot, String> {
    store.load_llm_thread(request)
}

pub fn content_hash(text: &str) -> String {
    content_hash_bytes(text.as_bytes())
}

pub fn content_hash_bytes(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hash = String::with_capacity(digest.len() * 2);
    for byte in digest {
        let _ = write!(&mut hash, "{byte:02x}");
    }
    hash
}

pub fn validate_document_transaction(
    base_text: &str,
    resulting_text: &str,
    changes: &[DocumentTextChange],
) -> Result<(), String> {
    inverse_changes_for_transaction(base_text, resulting_text, changes).map(|_| ())
}

fn inverse_changes_for_transaction(
    base_text: &str,
    resulting_text: &str,
    changes: &[DocumentTextChange],
) -> Result<(String, Vec<DocumentTextChange>), String> {
    let mut current = base_text.to_owned();
    let mut inverse_changes = Vec::with_capacity(changes.len());

    for change in changes {
        let (start, end) = byte_range_to_indices(&current, &change.range)?;
        let deleted_text = current[start..end].to_owned();
        current.replace_range(start..end, &change.text);
        inverse_changes.push(DocumentTextChange {
            range: SourceRange {
                start: change.range.start,
                end: change.range.start + change.text.len() as i64,
            },
            text: deleted_text,
        });
    }

    if current != resulting_text {
        return Err("document transaction changes do not produce the saved content".to_owned());
    }

    inverse_changes.reverse();
    Ok((current, inverse_changes))
}

fn byte_range_to_indices(text: &str, range: &SourceRange) -> Result<(usize, usize), String> {
    if range.start < 0 || range.end < 0 || range.start > range.end {
        return Err("document change range is invalid".to_owned());
    }
    let start = usize::try_from(range.start).map_err(|_| "range start is invalid".to_owned())?;
    let end = usize::try_from(range.end).map_err(|_| "range end is invalid".to_owned())?;
    if end > text.len() {
        return Err("document change range exceeds source length".to_owned());
    }
    if !text.is_char_boundary(start) || !text.is_char_boundary(end) {
        return Err("document change range must align to UTF-8 boundaries".to_owned());
    }
    Ok((start, end))
}

/// Open a SQLite connection tuned for Compose's concurrent access. `busy_timeout`
/// makes a call wait for a brief writer lock instead of failing with "database
/// is locked"; WAL lets reads proceed while a write is in flight.
fn open_connection(db_path: &Path) -> Result<Connection, String> {
    let mut connection = Connection::open(db_path)
        .map_err(|error| format!("could not open metadata db: {error}"))?;
    connection
        .execute_batch(
            "pragma busy_timeout = 5000;
             pragma journal_mode = wal;
             pragma synchronous = normal;
             pragma foreign_keys = on;",
        )
        .map_err(|error| format!("could not configure metadata db: {error}"))?;
    // Default writes to BEGIN IMMEDIATE so a read-then-write transaction takes
    // the write lock up front instead of upgrading mid-transaction. The upgrade
    // is what deadlocks two concurrent writers into "database is locked" —
    // busy_timeout retries a blocked BEGIN, but not a blocked lock upgrade.
    connection.set_transaction_behavior(TransactionBehavior::Immediate);
    Ok(connection)
}

fn migrate_global_database(db_path: &Path) -> Result<(), String> {
    let connection = open_connection(db_path)?;
    connection
        .execute_batch(
            "
            create table if not exists vaults (
              vault_id text primary key,
              display_name text not null,
              current_root_path text not null,
              root_fingerprint text,
              created_at integer not null,
              last_opened_at integer not null,
              deleted_at integer
            );
            create table if not exists vault_path_history (
              vault_id text not null,
              root_path text not null,
              first_seen_at integer not null,
              last_seen_at integer not null,
              primary key (vault_id, root_path)
            );
            create table if not exists app_settings (
              key text primary key,
              value_json text not null,
              updated_at integer not null
            );
            create table if not exists trash_entries (
              id text primary key,
              vault_id text not null,
              original_path text not null,
              trashed_name text not null,
              size_bytes integer not null,
              trashed_at integer not null
            );
            create index if not exists idx_trash_entries_trashed_at
              on trash_entries(trashed_at);
            ",
        )
        .map_err(|error| format!("could not migrate app metadata db: {error}"))?;
    Ok(())
}

fn migrate_vault_database(db_path: &Path) -> Result<(), String> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not create vault metadata dir: {error}"))?;
    }
    let connection = open_connection(db_path)?;
    connection
        .execute_batch(
            "
            create table if not exists documents (
              doc_id text primary key,
              current_path text not null,
              title text,
              content_hash text not null,
              last_seen_mtime integer,
              last_seen_size integer,
              created_at integer not null,
              updated_at integer not null,
              deleted_at integer
            );
            create unique index if not exists idx_documents_current_path
              on documents(current_path)
              where deleted_at is null;
            create table if not exists document_path_history (
              doc_id text not null,
              path text not null,
              first_seen_at integer not null,
              last_seen_at integer not null,
              primary key (doc_id, path)
            );
            create table if not exists document_revisions (
              revision_id text primary key,
              doc_id text not null,
              parent_revision_id text,
              content_hash text not null,
              transaction_id text,
              created_at integer not null
            );
            -- The latest-revision-for-a-document lookup runs on every write
            -- (and now on every snapshot prune); index the doc + the recency it
            -- orders by so it stays a seek, not a scan, as revisions pile up.
            create index if not exists idx_document_revisions_doc
              on document_revisions(doc_id, created_at);
            create table if not exists transactions (
              transaction_id text primary key,
              doc_id text not null,
              origin text not null,
              base_revision_id text,
              resulting_revision_id text not null,
              changes_json text not null,
              inverse_changes_json text not null,
              created_at integer not null
            );
            create table if not exists document_snapshots (
              snapshot_id text primary key,
              doc_id text not null,
              revision_id text not null,
              content_hash text not null,
              compressed_text blob not null,
              codec integer not null default 0,
              uncompressed_size integer,
              created_at integer not null
            );
            -- This table is append-on-every-run and pruned per document, so its
            -- queries (list/prune by doc, lookup/backfill by revision) must not
            -- table-scan as history accumulates over months.
            create index if not exists idx_document_snapshots_doc
              on document_snapshots(doc_id);
            create index if not exists idx_document_snapshots_revision
              on document_snapshots(revision_id);
            create table if not exists comment_threads (
              thread_id text primary key,
              doc_id text not null,
              status text not null,
              anchor_json text not null,
              selected_text text not null,
              created_at integer not null,
              updated_at integer not null,
              resolved_at integer
            );
            create table if not exists comment_messages (
              message_id text primary key,
              thread_id text not null,
              author_kind text not null,
              body text not null,
              created_at integer not null
            );
            create table if not exists llm_threads (
              llm_thread_id text primary key,
              title text,
              source_kind text not null,
              source_id text,
              created_at integer not null,
              updated_at integer not null
            );
            create table if not exists llm_messages (
              llm_message_id text primary key,
              llm_thread_id text not null,
              role text not null,
              body text not null,
              created_at integer not null
            );
            create table if not exists llm_context_items (
              context_item_id text primary key,
              llm_thread_id text not null,
              doc_id text,
              source_range_json text,
              anchor_json text,
              selected_text_snapshot text,
              surrounding_context_snapshot text,
              document_revision_id text,
              created_at integer not null
            );
            create table if not exists conversations (
              conversation_id text primary key,
              title text,
              harness_id text,
              created_at integer not null,
              updated_at integer not null,
              archived_at integer,
              deleted_at integer,
              last_opened_at integer,
              context_files_json text
            );
            create table if not exists conversation_messages (
              message_id text primary key,
              conversation_id text not null,
              seq integer not null,
              role text not null,
              content text not null,
              trace_json text,
              stats_json text,
              run_status text,
              created_at integer not null
            );
            create index if not exists idx_conversation_messages_thread
              on conversation_messages(conversation_id, seq);
            create table if not exists search_backlinks (
              backlink_id text primary key,
              source_doc_id text not null,
              source_path text not null,
              target_doc_id text,
              target_path text not null,
              link_kind text not null,
              label text not null,
              source_range_json text not null,
              updated_at integer not null
            );
            create index if not exists idx_search_backlinks_target_doc
              on search_backlinks(target_doc_id);
            create index if not exists idx_search_backlinks_target_path
              on search_backlinks(target_path);
            create table if not exists search_tags (
              tag_id text primary key,
              doc_id text not null,
              path text not null,
              tag text not null,
              tag_kind text not null,
              source_range_json text not null,
              updated_at integer not null
            );
            create index if not exists idx_search_tags_tag
              on search_tags(tag);
            create table if not exists search_frontmatter (
              frontmatter_id text primary key,
              doc_id text not null,
              path text not null,
              key text not null,
              value text not null,
              source_range_json text not null,
              updated_at integer not null
            );
            create index if not exists idx_search_frontmatter_key
              on search_frontmatter(key);
            create table if not exists graph_edges (
              edge_id text primary key,
              from_doc_id text not null,
              from_path text not null,
              to_doc_id text,
              to_path text not null,
              edge_kind text not null,
              source_range_json text not null,
              updated_at integer not null
            );
            create index if not exists idx_graph_edges_from_doc
              on graph_edges(from_doc_id);
            create index if not exists idx_graph_edges_to_doc
              on graph_edges(to_doc_id);
            ",
        )
        .map_err(|error| format!("could not migrate vault metadata db: {error}"))?;

    // `create table if not exists` above seeds the columns for fresh DBs;
    // existing DBs from before the OPEN/ARCHIVE/DELETE split get the new
    // columns (and the indexes that reference them) added in place here.
    conversations::ensure_conversation_columns(&connection)?;
    snapshot::ensure_snapshot_columns(&connection)?;
    Ok(())
}

fn upsert_document(
    transaction: &Transaction<'_>,
    entry: &DocumentInventoryEntry,
    snapshot_text: Option<&[u8]>,
    transaction_id: Option<&str>,
    now: i64,
) -> rusqlite::Result<(String, String)> {
    let existing = transaction
        .query_row(
            "select doc_id, content_hash
             from documents
             where current_path = ?1
             order by
               case when deleted_at is null then 0 else 1 end,
               updated_at desc
             limit 1",
            params![entry.relative_path],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let size = i64::try_from(entry.last_seen_size).unwrap_or(i64::MAX);

    let doc_id = if let Some((doc_id, _previous_hash)) = existing {
        transaction.execute(
            "update documents
             set title = ?1,
                 content_hash = ?2,
                 last_seen_mtime = ?3,
                 last_seen_size = ?4,
                 updated_at = ?5,
                 deleted_at = null
             where doc_id = ?6",
            params![
                entry.title,
                entry.content_hash,
                entry.last_seen_mtime,
                size,
                now,
                doc_id,
            ],
        )?;
        doc_id
    } else {
        let doc_id = Uuid::new_v4().to_string();
        transaction.execute(
            "insert into documents
             (doc_id, current_path, title, content_hash, last_seen_mtime, last_seen_size, created_at, updated_at, deleted_at)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, null)",
            params![
                doc_id,
                entry.relative_path,
                entry.title,
                entry.content_hash,
                entry.last_seen_mtime,
                size,
                now,
            ],
        )?;
        doc_id
    };

    upsert_document_path_history(transaction, &doc_id, &entry.relative_path, now)?;
    let revision_id = record_revision_if_needed(
        transaction,
        &doc_id,
        &entry.content_hash,
        snapshot_text,
        transaction_id,
        now,
    )?;
    Ok((doc_id, revision_id))
}

fn upsert_document_path_history(
    transaction: &Transaction<'_>,
    doc_id: &str,
    path: &str,
    now: i64,
) -> rusqlite::Result<()> {
    transaction.execute(
        "insert into document_path_history
         (doc_id, path, first_seen_at, last_seen_at)
         values (?1, ?2, ?3, ?3)
         on conflict(doc_id, path) do update set
           last_seen_at = excluded.last_seen_at",
        params![doc_id, path, now],
    )?;
    Ok(())
}

fn record_revision_if_needed(
    transaction: &Transaction<'_>,
    doc_id: &str,
    content_hash: &str,
    snapshot_text: Option<&[u8]>,
    transaction_id: Option<&str>,
    now: i64,
) -> rusqlite::Result<String> {
    let latest = transaction
        .query_row(
            "select revision_id, content_hash
             from document_revisions
             where doc_id = ?1
             order by created_at desc
             limit 1",
            params![doc_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    if let Some((revision_id, latest_hash)) = latest.as_ref() {
        if latest_hash == content_hash {
            // Content is unchanged since the latest revision. If the caller
            // handed us a snapshot to preserve, make sure one actually exists
            // for this revision: a prior sync-only pass records a revision
            // with no snapshot blob, and callers like `record_document_written`
            // promise the content stays recoverable. Without this backfill the
            // "restore previous version" history would have a revision row but
            // nothing to restore.
            if let Some(snapshot_text) = snapshot_text {
                snapshot::ensure_snapshot_exists(
                    transaction,
                    doc_id,
                    revision_id,
                    content_hash,
                    snapshot_text,
                    now,
                )?;
            }
            return Ok(revision_id.clone());
        }
    }

    let revision_id = Uuid::new_v4().to_string();
    let parent_revision_id = latest.map(|(id, _)| id);
    transaction.execute(
        "insert into document_revisions
         (revision_id, doc_id, parent_revision_id, content_hash, transaction_id, created_at)
         values (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            revision_id,
            doc_id,
            parent_revision_id,
            content_hash,
            transaction_id,
            now,
        ],
    )?;

    if let Some(snapshot_text) = snapshot_text {
        snapshot::ensure_snapshot_exists(
            transaction,
            doc_id,
            &revision_id,
            content_hash,
            snapshot_text,
            now,
        )?;
    }

    Ok(revision_id)
}

fn parent_revision_for(
    transaction: &Transaction<'_>,
    revision_id: &str,
) -> rusqlite::Result<Option<String>> {
    transaction
        .query_row(
            "select parent_revision_id
             from document_revisions
             where revision_id = ?1",
            params![revision_id],
            |row| row.get(0),
        )
        .optional()
        .map(Option::flatten)
}

fn latest_revision_id_for_doc(
    transaction: &Transaction<'_>,
    doc_id: &str,
) -> rusqlite::Result<Option<String>> {
    transaction
        .query_row(
            "select revision_id
             from document_revisions
             where doc_id = ?1
             order by created_at desc
             limit 1",
            params![doc_id],
            |row| row.get(0),
        )
        .optional()
}

fn document_id_for_path(
    transaction: &Transaction<'_>,
    relative_path: &str,
) -> rusqlite::Result<Option<String>> {
    transaction
        .query_row(
            "select doc_id
             from documents
             where current_path = ?1 and deleted_at is null",
            params![relative_path],
            |row| row.get(0),
        )
        .optional()
}

fn mark_missing_documents_deleted(
    transaction: &Transaction<'_>,
    seen_paths: &[String],
    now: i64,
) -> rusqlite::Result<()> {
    let mut statement =
        transaction.prepare("select current_path from documents where deleted_at is null")?;
    let current_paths = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let seen = seen_paths.iter().collect::<std::collections::HashSet<_>>();

    for path in current_paths {
        if seen.contains(&path) {
            continue;
        }
        transaction.execute(
            "update documents
             set deleted_at = ?1, updated_at = ?1
             where current_path = ?2 and deleted_at is null",
            params![now, path],
        )?;
    }
    Ok(())
}

fn title_from_content_or_path(content: &str, relative_path: &str) -> Option<String> {
    content
        .lines()
        .find_map(|line| line.strip_prefix("# ").map(str::trim))
        .filter(|title| !title.is_empty())
        .map(str::to_owned)
        .or_else(|| title_from_path(relative_path))
}

fn title_from_prompt(prompt: &str) -> String {
    let compact = prompt.split_whitespace().collect::<Vec<_>>().join(" ");
    compact.chars().take(80).collect()
}

fn source_kind_for_context_items(items: &[LlmContextSnapshotRequest]) -> &'static str {
    if items.iter().any(|item| item.kind == "comment") {
        "comment"
    } else if items.iter().any(|item| item.kind == "file") {
        "document"
    } else {
        "global"
    }
}

fn optional_json<T: Serialize>(value: &Option<T>) -> Result<Option<String>, String> {
    value
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| format!("could not encode LLM context JSON: {error}"))
}

fn optional_json_value<T>(value: Option<String>, label: &str) -> Result<Option<T>, String>
where
    T: for<'de> Deserialize<'de>,
{
    value
        .map(|json| {
            serde_json::from_str::<T>(&json)
                .map_err(|error| format!("could not decode {label}: {error}"))
        })
        .transpose()
}

fn load_llm_messages(
    connection: &Connection,
    llm_thread_id: &str,
) -> Result<Vec<LlmMessageRecord>, String> {
    let mut statement = connection
        .prepare(
            "select llm_message_id, role, body, created_at
             from llm_messages
             where llm_thread_id = ?1
             order by created_at asc, llm_message_id asc",
        )
        .map_err(|error| format!("could not prepare LLM message load: {error}"))?;
    let messages = statement
        .query_map(params![llm_thread_id], |row| {
            Ok(LlmMessageRecord {
                llm_message_id: row.get(0)?,
                role: row.get(1)?,
                body: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|error| format!("could not query LLM messages: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not read LLM messages: {error}"))?;
    Ok(messages)
}

fn load_llm_context_items(
    connection: &Connection,
    llm_thread_id: &str,
) -> Result<Vec<LlmContextSnapshotRecord>, String> {
    let mut statement = connection
        .prepare(
            "select
               lci.context_item_id,
               lci.doc_id,
               d.current_path,
               lci.source_range_json,
               lci.anchor_json,
               lci.selected_text_snapshot,
               lci.surrounding_context_snapshot,
               lci.document_revision_id,
               lci.created_at
             from llm_context_items lci
             left join documents d on d.doc_id = lci.doc_id
             where lci.llm_thread_id = ?1
             order by lci.created_at asc, lci.context_item_id asc",
        )
        .map_err(|error| format!("could not prepare LLM context load: {error}"))?;

    let rows = statement
        .query_map(params![llm_thread_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, i64>(8)?,
            ))
        })
        .map_err(|error| format!("could not query LLM context: {error}"))?;

    let mut items = Vec::new();
    for row in rows {
        let (
            context_item_id,
            doc_id,
            current_path,
            source_range_json,
            anchor_json,
            selected_text_snapshot,
            surrounding_context_snapshot,
            document_revision_id,
            created_at,
        ) = row.map_err(|error| format!("could not read LLM context: {error}"))?;
        items.push(LlmContextSnapshotRecord {
            anchor: optional_json_value(anchor_json, "LLM context anchor")?,
            context_item_id,
            created_at,
            current_path,
            doc_id,
            document_revision_id,
            selected_text_snapshot,
            source_range: optional_json_value(source_range_json, "LLM context source range")?,
            surrounding_context_snapshot,
        });
    }

    Ok(items)
}

pub fn title_from_path(relative_path: &str) -> Option<String> {
    Path::new(relative_path)
        .file_stem()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .map(str::to_owned)
}

fn validate_storage_id(value: &str, label: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} cannot be blank"));
    }
    if !trimmed
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(format!("{label} contains unsupported characters"));
    }
    Ok(())
}

fn validate_relative_metadata_path(relative_path: &str) -> Result<(), String> {
    let trimmed = relative_path.trim();
    if trimmed.is_empty() {
        return Err("document path cannot be blank".to_owned());
    }
    if trimmed.starts_with('/') || trimmed.contains('\\') {
        return Err("document path must be workspace-relative".to_owned());
    }
    if trimmed
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err("document path must stay inside the workspace".to_owned());
    }
    Ok(())
}

fn validate_source_range(range: &SourceRange, label: &str) -> Result<(), String> {
    if range.start < 0 || range.end < 0 || range.start >= range.end {
        return Err(format!("{label} range must not be empty"));
    }
    Ok(())
}

fn validate_llm_context_item(item: &LlmContextSnapshotRequest) -> Result<(), String> {
    validate_relative_metadata_path(&item.file_path)?;
    match item.kind.as_str() {
        "file" => Ok(()),
        "comment" => {
            if item
                .source_comment_id
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .is_empty()
            {
                return Err("LLM comment context requires a source comment id".to_owned());
            }
            let range = item
                .source_range
                .as_ref()
                .ok_or_else(|| "LLM comment context requires a source range".to_owned())?;
            validate_source_range(range, "LLM context")?;
            let anchor = item
                .anchor
                .as_ref()
                .ok_or_else(|| "LLM comment context requires an anchor snapshot".to_owned())?;
            validate_source_range(&anchor.range, "LLM anchor")?;
            if item
                .selected_text_snapshot
                .as_deref()
                .map(str::trim)
                .unwrap_or_default()
                .is_empty()
            {
                return Err("LLM comment context requires selected text".to_owned());
            }
            Ok(())
        }
        _ => Err("LLM context kind is invalid".to_owned()),
    }
}

fn validate_llm_message_role(role: &str) -> Result<(), String> {
    match role {
        "assistant" | "system" | "tool" | "user" => Ok(()),
        _ => Err("LLM message role is invalid".to_owned()),
    }
}

fn validate_comment(comment: &WorkspaceCommentThread) -> Result<(), String> {
    if comment.id.trim().is_empty() {
        return Err("comment id cannot be blank".to_owned());
    }
    validate_relative_metadata_path(&comment.file_path)?;
    if comment.status != "open" && comment.status != "resolved" {
        return Err("comment status is invalid".to_owned());
    }
    validate_source_range(&comment.anchor.range, "comment anchor")?;
    Ok(())
}

fn validate_search_index_records(records: &SearchIndexRecords) -> Result<(), String> {
    for backlink in &records.backlinks {
        validate_storage_id(&backlink.source_doc_id, "backlink source doc id")?;
        if let Some(target_doc_id) = &backlink.target_doc_id {
            validate_storage_id(target_doc_id, "backlink target doc id")?;
        }
        validate_relative_metadata_path(&backlink.source_path)?;
        validate_relative_metadata_path(&backlink.target_path)?;
        validate_index_kind(&backlink.kind, "backlink kind")?;
        validate_source_range(&backlink.source_range, "backlink source")?;
        if backlink.label.trim().is_empty() {
            return Err("backlink label cannot be blank".to_owned());
        }
    }

    for tag in &records.tags {
        validate_storage_id(&tag.doc_id, "tag doc id")?;
        validate_relative_metadata_path(&tag.path)?;
        validate_index_kind(&tag.kind, "tag kind")?;
        validate_source_range(&tag.source_range, "tag source")?;
        if tag.tag.trim().is_empty() {
            return Err("tag cannot be blank".to_owned());
        }
    }

    for frontmatter in &records.frontmatter {
        validate_storage_id(&frontmatter.doc_id, "frontmatter doc id")?;
        validate_relative_metadata_path(&frontmatter.path)?;
        validate_source_range(&frontmatter.source_range, "frontmatter source")?;
        if frontmatter.key.trim().is_empty() {
            return Err("frontmatter key cannot be blank".to_owned());
        }
    }

    for edge in &records.graph_edges {
        validate_storage_id(&edge.from_doc_id, "graph edge source doc id")?;
        if let Some(to_doc_id) = &edge.to_doc_id {
            validate_storage_id(to_doc_id, "graph edge target doc id")?;
        }
        validate_relative_metadata_path(&edge.from_path)?;
        validate_relative_metadata_path(&edge.to_path)?;
        validate_index_kind(&edge.kind, "graph edge kind")?;
        validate_source_range(&edge.source_range, "graph edge source")?;
    }

    Ok(())
}

fn validate_index_kind(value: &str, label: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} cannot be blank"));
    }
    if !trimmed
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(format!("{label} contains unsupported characters"));
    }
    Ok(())
}

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn comment(id: &str, file_path: &str) -> WorkspaceCommentThread {
        WorkspaceCommentThread {
            anchor: CommentAnchor {
                prefix: "before".to_owned(),
                range: SourceRange { start: 2, end: 8 },
                resolution: "resolved".to_owned(),
                selected_text: "select".to_owned(),
                suffix: "after".to_owned(),
            },
            body: "Check this".to_owned(),
            created_at: 10,
            file_path: file_path.to_owned(),
            id: id.to_owned(),
            status: "open".to_owned(),
            updated_at: 11,
        }
    }

    // Reproduce the chat-send write pattern: many conversations created
    // concurrently, each racing its first-message `save_conversation` against a
    // `record_llm_thread` on the SAME vault DB (both fire near-simultaneously in
    // `runSendChatPrompt`). A silently-failed save strands a 0-message "zombie"
    // hidden from the sidebar — the reported bug.
    #[test]
    fn concurrent_send_writes_never_zombie_a_conversation() {
        use std::sync::{Arc, Mutex};
        use std::thread;

        let (_dir, store, vault) = synced_store();
        let store = Arc::new(store);
        let errors = Arc::new(Mutex::new(Vec::<String>::new()));

        let handles: Vec<_> = (0..24)
            .map(|i| {
                let store = Arc::clone(&store);
                let errors = Arc::clone(&errors);
                thread::spawn(move || {
                    let conv = match store.new_conversation(vault, "ollama") {
                        Ok(id) => id,
                        Err(e) => return errors.lock().unwrap().push(format!("new[{i}]: {e}")),
                    };
                    let racer = {
                        let store = Arc::clone(&store);
                        thread::spawn(move || {
                            store.record_llm_thread(LlmThreadRecordRequest {
                                context_items: Vec::new(),
                                prompt: format!("hello {i}"),
                                workspace_id: vault.to_owned(),
                            })
                        })
                    };
                    let msg = ConversationMessageRecord {
                        message_id: format!("m{i}"),
                        role: "user".to_owned(),
                        content: format!("hello {i}"),
                        trace_json: None,
                        stats_json: None,
                        run_status: None,
                        created_at: 0,
                    };
                    if let Err(e) = store.save_conversation(vault, &conv, vec![msg], Vec::new()) {
                        errors.lock().unwrap().push(format!("save[{i}]: {e}"));
                    }
                    let _ = racer.join();
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }

        let errs = errors.lock().unwrap().clone();
        let convos = store.list_conversations(vault, true).expect("list");
        let zombies = convos.iter().filter(|c| c.message_count == 0).count();
        assert!(errs.is_empty(), "concurrent vault writes failed: {errs:?}");
        assert_eq!(zombies, 0, "{zombies} of {} conversations are 0-message zombies", convos.len());
    }

    fn synced_store() -> (tempfile::TempDir, MetadataStore, &'static str) {
        let dir = tempdir().expect("temp dir");
        let store = MetadataStore::default();
        store.init_from_dir(dir.path()).expect("init metadata");
        store
            .ensure_vault("vault-1", "Research", Path::new("/tmp/research"))
            .expect("ensure vault");
        store
            .sync_documents(
                "vault-1",
                vec![DocumentInventoryEntry {
                    content_hash: content_hash("# A\n\nText"),
                    last_seen_mtime: 10,
                    last_seen_size: 9,
                    relative_path: "notes/a.md".to_owned(),
                    title: Some("A".to_owned()),
                }],
            )
            .expect("sync docs");
        (dir, store, "vault-1")
    }

    #[test]
    fn creates_app_and_vault_databases_outside_the_workspace() {
        let data_dir = tempdir().expect("data dir");
        let workspace_dir = tempdir().expect("workspace dir");
        let store = MetadataStore::default();
        store.init_from_dir(data_dir.path()).expect("init metadata");
        store
            .ensure_vault("vault-1", "Research", workspace_dir.path())
            .expect("ensure vault");

        assert!(data_dir.path().join("app.db").is_file());
        assert!(data_dir
            .path()
            .join("vaults")
            .join("vault-1")
            .join("vault.db")
            .is_file());
        // The databases live in the data dir (asserted above), never in the
        // user's workspace folder. Assert it was left completely untouched
        // rather than spot-checking specific (now-historical) file names.
        let workspace_entry_count = std::fs::read_dir(workspace_dir.path())
            .expect("read workspace dir")
            .count();
        assert_eq!(
            workspace_entry_count, 0,
            "the workspace folder must not receive any metadata files",
        );
    }

    #[test]
    fn sync_documents_assigns_stable_doc_id_across_explicit_rename() {
        let (_dir, store, vault_id) = synced_store();
        let before = doc_id_for_test(&store, vault_id, "notes/a.md");

        store
            .rename_document(vault_id, "notes/a.md", "notes/b.md")
            .expect("rename document");

        assert_eq!(doc_id_for_test(&store, vault_id, "notes/b.md"), before);
        let paths = path_history_for_test(&store, vault_id, &before);
        assert_eq!(
            paths,
            vec!["notes/a.md".to_owned(), "notes/b.md".to_owned()]
        );
    }

    #[test]
    fn retained_path_is_not_deleted_when_its_content_was_unreadable() {
        let (_dir, store, vault_id) = synced_store();
        let before = doc_id_for_test(&store, vault_id, "notes/a.md");

        // A rebuild whose scan still saw `notes/a.md` but couldn't read its
        // bytes (dataless iCloud note): it carries no fresh inventory row, only
        // a retained path. The document must survive untouched.
        store
            .sync_documents_retaining(vault_id, Vec::new(), &["notes/a.md".to_owned()])
            .expect("retaining sync");

        assert_eq!(
            store
                .document_ids_by_path(vault_id)
                .expect("doc ids")
                .get("notes/a.md")
                .cloned(),
            Some(before),
            "a retained (unreadable) path must keep its live metadata row"
        );
    }

    #[test]
    fn plain_sync_deletes_a_path_the_scan_no_longer_sees() {
        let (_dir, store, vault_id) = synced_store();

        store
            .sync_documents(vault_id, Vec::new())
            .expect("empty sync");

        assert!(
            !store
                .document_ids_by_path(vault_id)
                .expect("doc ids")
                .contains_key("notes/a.md"),
            "a genuinely absent path must be marked deleted"
        );
    }

    #[test]
    fn comments_are_stored_by_doc_id_and_survive_document_rename() {
        let (_dir, store, vault_id) = synced_store();
        store
            .save_comments(vault_id, vec![comment("comment-1", "notes/a.md")])
            .expect("save comments");

        store
            .rename_document(vault_id, "notes/a.md", "notes/renamed.md")
            .expect("rename");

        assert_eq!(
            store.load_comments(vault_id).expect("load comments"),
            vec![comment("comment-1", "notes/renamed.md")]
        );
    }

    #[test]
    fn records_document_transaction_with_inverse_changes() {
        let (_dir, store, vault_id) = synced_store();
        store
            .record_document_transaction(
                vault_id,
                "notes/a.md",
                DocumentEdit {
                    base_text: "# A\n\nText",
                    resulting_text: "# A!\n\nText",
                    changes: vec![DocumentTextChange {
                        range: SourceRange { start: 3, end: 3 },
                        text: "!".to_owned(),
                    }],
                },
                20,
                10,
            )
            .expect("record transaction");

        let (changes_json, inverse_json) =
            transaction_json_for_test(&store, vault_id, "notes/a.md");
        assert_eq!(
            serde_json::from_str::<Vec<DocumentTextChange>>(&changes_json).expect("changes"),
            vec![DocumentTextChange {
                range: SourceRange { start: 3, end: 3 },
                text: "!".to_owned(),
            }]
        );
        assert_eq!(
            serde_json::from_str::<Vec<DocumentTextChange>>(&inverse_json).expect("inverse"),
            vec![DocumentTextChange {
                range: SourceRange { start: 3, end: 4 },
                text: "".to_owned(),
            }]
        );
    }

    #[test]
    fn rejects_transaction_when_changes_do_not_match_saved_text() {
        let (_dir, store, vault_id) = synced_store();
        let error = store
            .record_document_transaction(
                vault_id,
                "notes/a.md",
                DocumentEdit {
                    base_text: "# A\n\nText",
                    resulting_text: "# Different",
                    changes: vec![DocumentTextChange {
                        range: SourceRange { start: 3, end: 3 },
                        text: "!".to_owned(),
                    }],
                },
                20,
                10,
            )
            .expect_err("mismatched transaction must fail");

        assert!(error.contains("do not produce the saved content"));
    }

    #[test]
    fn records_llm_thread_with_auditable_comment_context_snapshot() {
        let (_dir, store, vault_id) = synced_store();
        let request = LlmThreadRecordRequest {
            context_items: vec![LlmContextSnapshotRequest {
                anchor: Some(comment("comment-1", "notes/a.md").anchor),
                file_path: "notes/a.md".to_owned(),
                kind: "comment".to_owned(),
                selected_text_snapshot: Some("select".to_owned()),
                source_comment_id: Some("comment-1".to_owned()),
                source_range: Some(SourceRange { start: 2, end: 8 }),
                surrounding_context_snapshot: Some("beforeselectafter".to_owned()),
            }],
            prompt: "  Help with this selection.  ".to_owned(),
            workspace_id: vault_id.to_owned(),
        };

        let result = store.record_llm_thread(request).expect("record LLM thread");
        let snapshot = llm_snapshot_for_test(&store, vault_id, &result.llm_thread_id);

        assert_eq!(snapshot.source_kind, "comment");
        assert_eq!(snapshot.source_id, Some("comment-1".to_owned()));
        assert_eq!(snapshot.user_message_body, "Help with this selection.");
        assert_eq!(
            serde_json::from_str::<SourceRange>(
                snapshot.source_range_json.as_deref().expect("source range")
            )
            .expect("source range json"),
            SourceRange { start: 2, end: 8 }
        );
        assert_eq!(snapshot.selected_text_snapshot, Some("select".to_owned()));
        assert_eq!(
            snapshot.surrounding_context_snapshot,
            Some("beforeselectafter".to_owned())
        );
        assert!(snapshot.document_revision_id.is_some());
        assert!(snapshot.anchor_json.is_some());
    }

    #[test]
    fn stores_llm_context_for_unknown_document_without_failing() {
        // An unregistered context file (the background index hasn't run yet, or a
        // scanned-but-unedited file) must NOT fail the send — the snapshot is what
        // the agent uses; the doc/revision linkage is best-effort, left null.
        let (_dir, store, vault_id) = synced_store();
        store
            .record_llm_thread(LlmThreadRecordRequest {
                context_items: vec![LlmContextSnapshotRequest {
                    anchor: None,
                    file_path: "notes/missing.md".to_owned(),
                    kind: "file".to_owned(),
                    selected_text_snapshot: Some("snippet".to_owned()),
                    source_comment_id: None,
                    source_range: None,
                    surrounding_context_snapshot: None,
                }],
                prompt: "Summarize".to_owned(),
                workspace_id: vault_id.to_owned(),
            })
            .expect("an unregistered context document must not fail the send");
    }

    #[test]
    fn appends_assistant_response_to_persisted_llm_thread() {
        let (_dir, store, vault_id) = synced_store();
        let thread = store
            .record_llm_thread(LlmThreadRecordRequest {
                context_items: vec![LlmContextSnapshotRequest {
                    anchor: None,
                    file_path: "notes/a.md".to_owned(),
                    kind: "file".to_owned(),
                    selected_text_snapshot: None,
                    source_comment_id: None,
                    source_range: None,
                    surrounding_context_snapshot: None,
                }],
                prompt: "Summarize".to_owned(),
                workspace_id: vault_id.to_owned(),
            })
            .expect("record thread");

        store
            .append_llm_message(LlmMessageAppendRequest {
                body: "Summary text".to_owned(),
                llm_thread_id: thread.llm_thread_id.clone(),
                role: "assistant".to_owned(),
                workspace_id: vault_id.to_owned(),
            })
            .expect("append assistant");

        assert_eq!(
            llm_messages_for_test(&store, vault_id, &thread.llm_thread_id),
            vec![
                ("user".to_owned(), "Summarize".to_owned()),
                ("assistant".to_owned(), "Summary text".to_owned()),
            ]
        );
    }

    #[test]
    fn loads_llm_thread_with_current_document_path_and_immutable_context() {
        let (_dir, store, vault_id) = synced_store();
        let thread = store
            .record_llm_thread(LlmThreadRecordRequest {
                context_items: vec![LlmContextSnapshotRequest {
                    anchor: Some(comment("comment-1", "notes/a.md").anchor),
                    file_path: "notes/a.md".to_owned(),
                    kind: "comment".to_owned(),
                    selected_text_snapshot: Some("select".to_owned()),
                    source_comment_id: Some("comment-1".to_owned()),
                    source_range: Some(SourceRange { start: 2, end: 8 }),
                    surrounding_context_snapshot: Some("beforeselectafter".to_owned()),
                }],
                prompt: "What did this sentence imply?".to_owned(),
                workspace_id: vault_id.to_owned(),
            })
            .expect("record thread");
        store
            .append_llm_message(LlmMessageAppendRequest {
                body: "It implies the document needs a sharper claim.".to_owned(),
                llm_thread_id: thread.llm_thread_id.clone(),
                role: "assistant".to_owned(),
                workspace_id: vault_id.to_owned(),
            })
            .expect("append assistant");
        store
            .rename_document(vault_id, "notes/a.md", "notes/renamed.md")
            .expect("rename document");

        let loaded = store
            .load_llm_thread(LlmThreadLoadRequest {
                llm_thread_id: thread.llm_thread_id.clone(),
                workspace_id: vault_id.to_owned(),
            })
            .expect("load thread");

        assert_eq!(loaded.llm_thread_id, thread.llm_thread_id);
        assert_eq!(loaded.source_kind, "comment");
        assert_eq!(loaded.source_id, Some("comment-1".to_owned()));
        assert_eq!(
            loaded
                .messages
                .iter()
                .map(|message| (message.role.as_str(), message.body.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("user", "What did this sentence imply?"),
                (
                    "assistant",
                    "It implies the document needs a sharper claim."
                ),
            ]
        );
        assert_eq!(loaded.context_items.len(), 1);
        let context = &loaded.context_items[0];
        assert_eq!(context.current_path, Some("notes/renamed.md".to_owned()));
        assert_eq!(context.source_range, Some(SourceRange { start: 2, end: 8 }));
        assert_eq!(context.selected_text_snapshot, Some("select".to_owned()));
        assert_eq!(
            context.surrounding_context_snapshot,
            Some("beforeselectafter".to_owned())
        );
        assert_eq!(
            context
                .anchor
                .as_ref()
                .map(|anchor| anchor.selected_text.as_str()),
            Some("select")
        );
        assert!(context.document_revision_id.is_some());
    }

    #[test]
    fn rejects_llm_message_for_unknown_thread() {
        let (_dir, store, vault_id) = synced_store();
        let error = store
            .append_llm_message(LlmMessageAppendRequest {
                body: "orphan".to_owned(),
                llm_thread_id: "missing-thread".to_owned(),
                role: "assistant".to_owned(),
                workspace_id: vault_id.to_owned(),
            })
            .expect_err("unknown thread must fail");

        assert_eq!(error, "LLM thread is not registered");
    }

    #[test]
    fn rejects_loading_unknown_llm_thread() {
        let (_dir, store, vault_id) = synced_store();
        let error = store
            .load_llm_thread(LlmThreadLoadRequest {
                llm_thread_id: "missing-thread".to_owned(),
                workspace_id: vault_id.to_owned(),
            })
            .expect_err("unknown thread must fail");

        assert_eq!(error, "LLM thread is not registered");
    }

    #[test]
    fn saves_and_loads_comments_from_per_vault_database() {
        let (dir, store, vault_id) = synced_store();

        store
            .save_comments(vault_id, vec![comment("comment-1", "notes/a.md")])
            .expect("save comments");

        assert_eq!(
            store.load_comments(vault_id).expect("load comments"),
            vec![comment("comment-1", "notes/a.md")]
        );
        assert!(dir
            .path()
            .join("vaults")
            .join(vault_id)
            .join("vault.db")
            .is_file());
    }

    #[test]
    fn replaces_comments_per_vault_without_touching_others() {
        let dir = tempdir().expect("temp dir");
        let store = MetadataStore::default();
        store.init_from_dir(dir.path()).expect("init metadata");
        for vault_id in ["vault-1", "vault-2"] {
            store
                .ensure_vault(vault_id, vault_id, Path::new("/tmp/vault"))
                .expect("ensure vault");
            store
                .sync_documents(
                    vault_id,
                    vec![DocumentInventoryEntry {
                        content_hash: content_hash("hello"),
                        last_seen_mtime: 10,
                        last_seen_size: 5,
                        relative_path: "notes/a.md".to_owned(),
                        title: None,
                    }],
                )
                .expect("sync doc");
        }

        store
            .save_comments("vault-1", vec![comment("comment-1", "notes/a.md")])
            .expect("save first vault");
        store
            .save_comments("vault-2", vec![comment("comment-2", "notes/a.md")])
            .expect("save second vault");
        store
            .save_comments("vault-1", vec![comment("comment-3", "notes/a.md")])
            .expect("replace first vault");

        assert_eq!(
            store.load_comments("vault-1").expect("load first"),
            vec![comment("comment-3", "notes/a.md")]
        );
        assert_eq!(
            store.load_comments("vault-2").expect("load second"),
            vec![comment("comment-2", "notes/a.md")]
        );
    }

    #[test]
    fn replaces_search_index_records_in_vault_metadata() {
        let (_dir, store, vault_id) = synced_store();
        let doc_id = doc_id_for_test(&store, vault_id, "notes/a.md");
        let records = SearchIndexRecords {
            backlinks: vec![SearchBacklinkRecord {
                kind: "wikilink".to_owned(),
                label: "A".to_owned(),
                source_doc_id: doc_id.clone(),
                source_path: "notes/a.md".to_owned(),
                source_range: SourceRange { start: 2, end: 7 },
                target_doc_id: Some(doc_id.clone()),
                target_path: "notes/a.md".to_owned(),
            }],
            frontmatter: vec![SearchFrontmatterRecord {
                doc_id: doc_id.clone(),
                key: "owner".to_owned(),
                path: "notes/a.md".to_owned(),
                source_range: SourceRange { start: 8, end: 18 },
                value: "Bob".to_owned(),
            }],
            graph_edges: vec![SearchGraphEdgeRecord {
                from_doc_id: doc_id.clone(),
                from_path: "notes/a.md".to_owned(),
                kind: "wikilink".to_owned(),
                source_range: SourceRange { start: 2, end: 7 },
                to_doc_id: Some(doc_id.clone()),
                to_path: "notes/a.md".to_owned(),
            }],
            tags: vec![SearchTagRecord {
                doc_id,
                kind: "inline".to_owned(),
                path: "notes/a.md".to_owned(),
                source_range: SourceRange { start: 20, end: 26 },
                tag: "idea".to_owned(),
            }],
        };

        store
            .replace_search_index_records(vault_id, records)
            .expect("replace index");

        assert_eq!(search_index_counts_for_test(&store, vault_id), (1, 1, 1, 1));

        store
            .replace_search_index_records(
                vault_id,
                SearchIndexRecords {
                    backlinks: vec![],
                    frontmatter: vec![],
                    graph_edges: vec![],
                    tags: vec![],
                },
            )
            .expect("clear index");

        assert_eq!(search_index_counts_for_test(&store, vault_id), (0, 0, 0, 0));
    }

    fn doc_id_for_test(store: &MetadataStore, vault_id: &str, relative_path: &str) -> String {
        let connection = store.vault_connection(vault_id).expect("connection");
        connection
            .query_row(
                "select doc_id from documents where current_path = ?1 and deleted_at is null",
                params![relative_path],
                |row| row.get(0),
            )
            .expect("doc id")
    }

    fn path_history_for_test(store: &MetadataStore, vault_id: &str, doc_id: &str) -> Vec<String> {
        let connection = store.vault_connection(vault_id).expect("connection");
        let mut statement = connection
            .prepare(
                "select path from document_path_history
                 where doc_id = ?1
                 order by first_seen_at asc, path asc",
            )
            .expect("prepare");
        statement
            .query_map(params![doc_id], |row| row.get::<_, String>(0))
            .expect("query")
            .collect::<Result<Vec<_>, _>>()
            .expect("paths")
    }

    fn transaction_json_for_test(
        store: &MetadataStore,
        vault_id: &str,
        relative_path: &str,
    ) -> (String, String) {
        let connection = store.vault_connection(vault_id).expect("connection");
        connection
            .query_row(
                "select t.changes_json, t.inverse_changes_json
                 from transactions t
                 join documents d on d.doc_id = t.doc_id
                 where d.current_path = ?1
                 order by t.created_at desc
                 limit 1",
                params![relative_path],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("transaction")
    }

    struct LlmSnapshotForTest {
        anchor_json: Option<String>,
        document_revision_id: Option<String>,
        selected_text_snapshot: Option<String>,
        source_id: Option<String>,
        source_kind: String,
        source_range_json: Option<String>,
        surrounding_context_snapshot: Option<String>,
        user_message_body: String,
    }

    fn llm_snapshot_for_test(
        store: &MetadataStore,
        vault_id: &str,
        llm_thread_id: &str,
    ) -> LlmSnapshotForTest {
        let connection = store.vault_connection(vault_id).expect("connection");
        connection
            .query_row(
                "select
                   lt.source_kind,
                   lt.source_id,
                   lm.body,
                   lci.source_range_json,
                   lci.anchor_json,
                   lci.selected_text_snapshot,
                   lci.surrounding_context_snapshot,
                   lci.document_revision_id
                 from llm_threads lt
                 join llm_messages lm on lm.llm_thread_id = lt.llm_thread_id
                 join llm_context_items lci on lci.llm_thread_id = lt.llm_thread_id
                 where lt.llm_thread_id = ?1
                 limit 1",
                params![llm_thread_id],
                |row| {
                    Ok(LlmSnapshotForTest {
                        source_kind: row.get(0)?,
                        source_id: row.get(1)?,
                        user_message_body: row.get(2)?,
                        source_range_json: row.get(3)?,
                        anchor_json: row.get(4)?,
                        selected_text_snapshot: row.get(5)?,
                        surrounding_context_snapshot: row.get(6)?,
                        document_revision_id: row.get(7)?,
                    })
                },
            )
            .expect("LLM snapshot")
    }

    fn llm_messages_for_test(
        store: &MetadataStore,
        vault_id: &str,
        llm_thread_id: &str,
    ) -> Vec<(String, String)> {
        let connection = store.vault_connection(vault_id).expect("connection");
        let mut statement = connection
            .prepare(
                "select role, body
                 from llm_messages
                 where llm_thread_id = ?1
                 order by created_at asc",
            )
            .expect("prepare");
        statement
            .query_map(params![llm_thread_id], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query")
            .collect::<Result<Vec<_>, _>>()
            .expect("messages")
    }

    fn search_index_counts_for_test(store: &MetadataStore, vault_id: &str) -> (i64, i64, i64, i64) {
        let connection = store.vault_connection(vault_id).expect("connection");
        let backlinks = connection
            .query_row("select count(*) from search_backlinks", [], |row| {
                row.get(0)
            })
            .expect("backlink count");
        let tags = connection
            .query_row("select count(*) from search_tags", [], |row| row.get(0))
            .expect("tag count");
        let frontmatter = connection
            .query_row("select count(*) from search_frontmatter", [], |row| {
                row.get(0)
            })
            .expect("frontmatter count");
        let graph_edges = connection
            .query_row("select count(*) from graph_edges", [], |row| row.get(0))
            .expect("graph count");
        (backlinks, tags, frontmatter, graph_edges)
    }

    // Conversation persistence tests live with their module in
    // `db/conversations.rs` (the OPEN / ARCHIVE / DELETE lifecycle, list
    // derivation, rename / duplicate, soft-delete, and migration idempotence).
}
