//! Conversation persistence — the chat history layer for a workspace vault.
//!
//! This module owns three *orthogonal* lifecycle concepts the chat panel
//! treats as independent axes. Conflating them (as the original schema did,
//! where "not archived" doubled as "currently open") is the bug this module
//! exists to prevent:
//!
//! - **OPEN** — which conversation the panel shows. Tracked by
//!   `last_opened_at`, bumped every time a conversation is opened. Switching
//!   the open conversation touches nothing about the others; on workspace
//!   load we restore the most-recently-*opened* one.
//! - **ARCHIVE** — a deliberate "file this away" (`archived_at`). Archived
//!   conversations drop out of the main list but stay fully recoverable.
//! - **DELETE** — a *soft* delete (`deleted_at`) into a recoverable trash. We
//!   never hard-destroy a user's conversation on a click; a purge path can
//!   come later.
//!
//! The store methods live here as a second `impl MetadataStore` block (the
//! struct itself is defined in [`super`]); the Tauri command wrappers that
//! expose them across the IPC boundary sit at the bottom of the file. Schema
//! evolution for the `conversations` table is [`ensure_conversation_columns`],
//! called once from `migrate_vault_database`.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::State;
use uuid::Uuid;

use super::{now_ms, validate_storage_id, MetadataStore};

/// One persisted chat turn. `trace_json` / `stats_json` are opaque JSON owned
/// by the TS layer (the consolidated `TraceEntry[]` and run stats); Rust just
/// round-trips them. The user / answer text is `content`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessageRecord {
    pub message_id: String,
    pub role: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace_json: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stats_json: Option<String>,
    /// Lifecycle of the run that produced this message: `"streaming"` while a
    /// reply is being written, cleared (`None`) once it settles. A reply left
    /// `"streaming"` on disk means its run never finished (app quit/crashed
    /// mid-stream) — load reads that as interrupted. `None` for settled turns
    /// and every user message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_status: Option<String>,
    pub created_at: i64,
}

/// A whole conversation restored into the open chat thread — its row plus its
/// messages in `seq` order. `title` here is the *raw* stored title (often
/// `None`); the resolved, display-ready title lives on [`ConversationSummary`].
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSnapshot {
    pub conversation_id: String,
    pub title: Option<String>,
    pub harness_id: Option<String>,
    pub context_files: Vec<String>,
    pub messages: Vec<ConversationMessageRecord>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// A history-list entry: enough to render a row without loading every
/// message. `title` and `preview` are *derived* (see [`derive_title`] /
/// [`make_preview`]) so the list never shows a blank or raw-id row.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub conversation_id: String,
    /// Explicit title if the user set one, else derived from the first user
    /// message; never empty (falls back to "New conversation").
    pub title: String,
    pub harness_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub message_count: i64,
    /// First ~120 chars of the first message, for the row's snippet.
    pub preview: String,
    pub archived: bool,
    /// Labels of the files that were in context (from `context_files_json`).
    pub context_files: Vec<String>,
}

/// Longest a derived title runs before we ellipsize it.
const TITLE_MAX_CHARS: usize = 60;
/// Longest a row preview snippet runs.
const PREVIEW_MAX_CHARS: usize = 120;
/// The placeholder shown for a not-yet-named conversation. Reserved: it's never
/// treated as a real explicit title (an older build could persist it by blurring
/// the rename field on an unnamed chat), so it always falls back to the
/// first-message-derived title.
const NEW_CONVERSATION_TITLE: &str = "New conversation";

impl MetadataStore {
    /// The most-recently-*opened* non-archived, non-deleted conversation —
    /// the one to restore into the chat panel on workspace load. Ordered by
    /// `last_opened_at` (newest first, NULLs last) with `updated_at` as a
    /// tiebreak so pre-migration rows (no `last_opened_at`) still resolve.
    /// Read-only: restoring does **not** count as opening, so it never
    /// reshuffles the ordering.
    pub fn load_active_conversation(
        &self,
        workspace_id: &str,
    ) -> Result<Option<ConversationSnapshot>, String> {
        validate_storage_id(workspace_id, "workspace id")?;
        let connection = self.vault_connection(workspace_id)?;
        let head = connection
            .query_row(
                "select conversation_id, title, harness_id, context_files_json,
                        created_at, updated_at
                 from conversations
                 where archived_at is null and deleted_at is null
                 order by (last_opened_at is null), last_opened_at desc,
                          updated_at desc, conversation_id desc
                 limit 1",
                [],
                read_conversation_head,
            )
            .optional()
            .map_err(|error| format!("could not load conversation: {error}"))?;

        self.snapshot_from_head(&connection, head)
    }

    /// Load a specific conversation **and** bump its `last_opened_at` — this
    /// is the act of *opening* it (per the OPEN axis). Returns `None` if it
    /// doesn't exist or was soft-deleted.
    pub fn load_conversation(
        &self,
        workspace_id: &str,
        conversation_id: &str,
    ) -> Result<Option<ConversationSnapshot>, String> {
        validate_storage_id(workspace_id, "workspace id")?;
        validate_storage_id(conversation_id, "conversation id")?;
        let now = now_ms();
        let connection = self.vault_connection(workspace_id)?;
        connection
            .execute(
                "update conversations set last_opened_at = ?2
                 where conversation_id = ?1 and deleted_at is null",
                params![conversation_id, now],
            )
            .map_err(|error| format!("could not mark conversation opened: {error}"))?;

        let head = connection
            .query_row(
                "select conversation_id, title, harness_id, context_files_json,
                        created_at, updated_at
                 from conversations
                 where conversation_id = ?1 and deleted_at is null",
                params![conversation_id],
                read_conversation_head,
            )
            .optional()
            .map_err(|error| format!("could not load conversation: {error}"))?;

        self.snapshot_from_head(&connection, head)
    }

    /// Every non-deleted conversation as a history-list summary, newest
    /// activity first. Archived ones are included only when `include_archived`
    /// is set (so the default list and the Archived filter share one query).
    pub fn list_conversations(
        &self,
        workspace_id: &str,
        include_archived: bool,
    ) -> Result<Vec<ConversationSummary>, String> {
        validate_storage_id(workspace_id, "workspace id")?;
        let connection = self.vault_connection(workspace_id)?;
        let mut statement = connection
            .prepare(
                "select c.conversation_id, c.title, c.harness_id, c.created_at,
                        c.updated_at, c.archived_at, c.context_files_json,
                        (select count(*) from conversation_messages m
                         where m.conversation_id = c.conversation_id) as message_count,
                        (select content from conversation_messages m
                         where m.conversation_id = c.conversation_id and m.role = 'user'
                         order by m.seq asc limit 1) as first_user,
                        (select content from conversation_messages m
                         where m.conversation_id = c.conversation_id
                         order by m.seq asc limit 1) as first_any
                 from conversations c
                 where c.deleted_at is null
                   and (?1 = 1 or c.archived_at is null)
                 order by c.updated_at desc, c.conversation_id desc",
            )
            .map_err(|error| format!("could not prepare conversation list: {error}"))?;

        let rows = statement
            .query_map(params![include_archived as i64], |row| {
                let title: Option<String> = row.get(1)?;
                let context_json: Option<String> = row.get(6)?;
                let first_user: Option<String> = row.get(8)?;
                let first_any: Option<String> = row.get(9)?;
                Ok(ConversationSummary {
                    conversation_id: row.get(0)?,
                    title: resolve_title(title.as_deref(), first_user.as_deref()),
                    harness_id: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                    message_count: row.get(7)?,
                    preview: make_preview(first_any.as_deref()),
                    archived: row.get::<_, Option<i64>>(5)?.is_some(),
                    context_files: parse_context_files(context_json.as_deref()),
                })
            })
            .map_err(|error| format!("could not query conversation list: {error}"))?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("could not read conversation list: {error}"))
    }

    /// Upsert a conversation and replace its full message set (the
    /// delete-then-insert shape `save_comments` uses — the front-end owns the
    /// authoritative list and re-saves it each turn). `created_at` is
    /// preserved across updates; `context_files` is persisted as JSON so the
    /// history list can show the file chips for a conversation.
    pub fn save_conversation(
        &self,
        workspace_id: &str,
        conversation_id: &str,
        messages: Vec<ConversationMessageRecord>,
        context_files: Vec<String>,
    ) -> Result<(), String> {
        validate_storage_id(workspace_id, "workspace id")?;
        validate_storage_id(conversation_id, "conversation id")?;
        let now = now_ms();
        let context_json = serde_json::to_string(&context_files)
            .map_err(|error| format!("could not encode context files: {error}"))?;
        let mut connection = self.vault_connection(workspace_id)?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("could not start metadata transaction: {error}"))?;

        // Upsert the row, preserving created_at on update. An insert here
        // (saving before a `new_conversation` ran) also seeds last_opened_at
        // so the freshly-saved conversation becomes the active one.
        transaction
            .execute(
                "insert into conversations
                   (conversation_id, title, harness_id, created_at, updated_at,
                    archived_at, deleted_at, last_opened_at, context_files_json)
                 values (?1, null, null, ?2, ?2, null, null, ?2, ?3)
                 on conflict(conversation_id) do update set
                   updated_at = ?2, context_files_json = ?3",
                params![conversation_id, now, context_json],
            )
            .map_err(|error| format!("could not upsert conversation: {error}"))?;

        transaction
            .execute(
                "delete from conversation_messages where conversation_id = ?1",
                params![conversation_id],
            )
            .map_err(|error| format!("could not replace conversation messages: {error}"))?;

        for (seq, message) in messages.iter().enumerate() {
            transaction
                .execute(
                    "insert into conversation_messages
                       (message_id, conversation_id, seq, role, content, trace_json, stats_json, run_status, created_at)
                     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                    params![
                        message.message_id,
                        conversation_id,
                        seq as i64,
                        message.role,
                        message.content,
                        message.trace_json,
                        message.stats_json,
                        message.run_status,
                        message.created_at,
                    ],
                )
                .map_err(|error| format!("could not save conversation message: {error}"))?;
        }

        transaction
            .commit()
            .map_err(|error| format!("could not commit conversation: {error}"))?;
        Ok(())
    }

    /// Start a fresh conversation stamped with the owning harness. It does
    /// **not** archive the prior one (archiving is a separate, deliberate
    /// action) — it just creates a row with `last_opened_at = now` so the new
    /// conversation becomes the active one.
    pub fn new_conversation(
        &self,
        workspace_id: &str,
        harness_id: &str,
    ) -> Result<String, String> {
        validate_storage_id(workspace_id, "workspace id")?;
        let now = now_ms();
        let connection = self.vault_connection(workspace_id)?;
        let conversation_id = Uuid::new_v4().to_string();
        let harness = (!harness_id.is_empty()).then(|| harness_id.to_owned());
        connection
            .execute(
                "insert into conversations
                   (conversation_id, title, harness_id, created_at, updated_at,
                    archived_at, deleted_at, last_opened_at, context_files_json)
                 values (?1, null, ?2, ?3, ?3, null, null, ?3, null)",
                params![conversation_id, harness, now],
            )
            .map_err(|error| format!("could not create conversation: {error}"))?;
        Ok(conversation_id)
    }

    /// Set or clear a conversation's explicit title. An empty / whitespace
    /// title is stored as `NULL`, which makes the list fall back to the
    /// derived title. Does not bump `updated_at` — a rename is metadata, not
    /// activity, so it must not reshuffle the history list.
    pub fn rename_conversation(
        &self,
        workspace_id: &str,
        conversation_id: &str,
        title: Option<String>,
    ) -> Result<(), String> {
        validate_storage_id(workspace_id, "workspace id")?;
        validate_storage_id(conversation_id, "conversation id")?;
        let title = title
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let connection = self.vault_connection(workspace_id)?;
        connection
            .execute(
                "update conversations set title = ?2
                 where conversation_id = ?1 and deleted_at is null",
                params![conversation_id, title],
            )
            .map_err(|error| format!("could not rename conversation: {error}"))?;
        Ok(())
    }

    /// Archive (or un-archive) a conversation — the ARCHIVE axis. Setting it
    /// drops the conversation out of the default list; clearing it restores
    /// it. Independent of OPEN and DELETE.
    pub fn set_conversation_archived(
        &self,
        workspace_id: &str,
        conversation_id: &str,
        archived: bool,
    ) -> Result<(), String> {
        validate_storage_id(workspace_id, "workspace id")?;
        validate_storage_id(conversation_id, "conversation id")?;
        let archived_at = archived.then(now_ms);
        let connection = self.vault_connection(workspace_id)?;
        connection
            .execute(
                "update conversations set archived_at = ?2
                 where conversation_id = ?1 and deleted_at is null",
                params![conversation_id, archived_at],
            )
            .map_err(|error| format!("could not archive conversation: {error}"))?;
        Ok(())
    }

    /// **Soft**-delete a conversation into the recoverable trash (DELETE
    /// axis). The row and its messages stay on disk; a future purge path can
    /// hard-destroy them. We never destroy a user's conversation on a click.
    pub fn delete_conversation(
        &self,
        workspace_id: &str,
        conversation_id: &str,
    ) -> Result<(), String> {
        validate_storage_id(workspace_id, "workspace id")?;
        validate_storage_id(conversation_id, "conversation id")?;
        let now = now_ms();
        let connection = self.vault_connection(workspace_id)?;
        connection
            .execute(
                "update conversations set deleted_at = ?2
                 where conversation_id = ?1 and deleted_at is null",
                params![conversation_id, now],
            )
            .map_err(|error| format!("could not delete conversation: {error}"))?;
        Ok(())
    }

    /// Duplicate a conversation: a fresh row (new id, `"<title> (copy)"`,
    /// `last_opened_at = now`, not archived/deleted) carrying copies of every
    /// message (new message ids, same seq / content / trace / stats). The
    /// copy's `created_at` is inherited from the source; `updated_at` is now.
    pub fn duplicate_conversation(
        &self,
        workspace_id: &str,
        conversation_id: &str,
    ) -> Result<String, String> {
        validate_storage_id(workspace_id, "workspace id")?;
        validate_storage_id(conversation_id, "conversation id")?;
        let now = now_ms();
        let mut connection = self.vault_connection(workspace_id)?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("could not start metadata transaction: {error}"))?;

        let source = transaction
            .query_row(
                "select title, harness_id, created_at, context_files_json
                 from conversations
                 where conversation_id = ?1 and deleted_at is null",
                params![conversation_id],
                |row| {
                    Ok((
                        row.get::<_, Option<String>>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("could not read source conversation: {error}"))?;

        let Some((title, harness_id, created_at, context_json)) = source else {
            return Err("conversation not found".to_owned());
        };

        // The copy gets an explicit title so it reads as a distinct entry even
        // if the source relied on a derived one.
        let first_user = transaction
            .query_row(
                "select content from conversation_messages
                 where conversation_id = ?1 and role = 'user'
                 order by seq asc limit 1",
                params![conversation_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("could not read source title source: {error}"))?;
        let copy_title = format!(
            "{} (copy)",
            resolve_title(title.as_deref(), first_user.as_deref())
        );

        let new_id = Uuid::new_v4().to_string();
        transaction
            .execute(
                "insert into conversations
                   (conversation_id, title, harness_id, created_at, updated_at,
                    archived_at, deleted_at, last_opened_at, context_files_json)
                 values (?1, ?2, ?3, ?4, ?5, null, null, ?5, ?6)",
                params![new_id, copy_title, harness_id, created_at, now, context_json],
            )
            .map_err(|error| format!("could not create duplicate conversation: {error}"))?;

        let source_messages = {
            let mut statement = transaction
                .prepare(
                    "select seq, role, content, trace_json, stats_json, created_at
                     from conversation_messages
                     where conversation_id = ?1
                     order by seq asc",
                )
                .map_err(|error| format!("could not prepare message copy: {error}"))?;
            let rows = statement
                .query_map(params![conversation_id], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                })
                .map_err(|error| format!("could not query source messages: {error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("could not read source messages: {error}"))?
        };

        for (seq, role, content, trace_json, stats_json, created) in source_messages {
            transaction
                .execute(
                    "insert into conversation_messages
                       (message_id, conversation_id, seq, role, content, trace_json, stats_json, created_at)
                     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        Uuid::new_v4().to_string(),
                        new_id,
                        seq,
                        role,
                        content,
                        trace_json,
                        stats_json,
                        created,
                    ],
                )
                .map_err(|error| format!("could not copy conversation message: {error}"))?;
        }

        transaction
            .commit()
            .map_err(|error| format!("could not commit duplicate conversation: {error}"))?;
        Ok(new_id)
    }

    /// Build a [`ConversationSnapshot`] from a decoded head row, loading its
    /// messages. Shared by the active-load and open-by-id paths.
    fn snapshot_from_head(
        &self,
        connection: &Connection,
        head: Option<ConversationHead>,
    ) -> Result<Option<ConversationSnapshot>, String> {
        let Some(head) = head else {
            return Ok(None);
        };
        let messages = load_conversation_messages(connection, &head.conversation_id)?;
        Ok(Some(ConversationSnapshot {
            conversation_id: head.conversation_id,
            title: head.title,
            harness_id: head.harness_id,
            context_files: head.context_files,
            messages,
            created_at: head.created_at,
            updated_at: head.updated_at,
        }))
    }
}

/// The decoded scalar columns of a conversation row, before its messages are
/// attached. Internal glue between the row reader and `snapshot_from_head`.
struct ConversationHead {
    conversation_id: String,
    title: Option<String>,
    harness_id: Option<String>,
    context_files: Vec<String>,
    created_at: i64,
    updated_at: i64,
}

/// Row mapper for the shared head `select` (columns in the order:
/// conversation_id, title, harness_id, context_files_json, created_at,
/// updated_at).
fn read_conversation_head(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConversationHead> {
    let context_json: Option<String> = row.get(3)?;
    Ok(ConversationHead {
        conversation_id: row.get(0)?,
        title: row.get(1)?,
        harness_id: row.get(2)?,
        context_files: parse_context_files(context_json.as_deref()),
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn load_conversation_messages(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Vec<ConversationMessageRecord>, String> {
    let mut statement = connection
        .prepare(
            "select message_id, role, content, trace_json, stats_json, run_status, created_at
             from conversation_messages
             where conversation_id = ?1
             order by seq asc",
        )
        .map_err(|error| format!("could not prepare conversation message load: {error}"))?;
    let messages = statement
        .query_map(params![conversation_id], |row| {
            Ok(ConversationMessageRecord {
                message_id: row.get(0)?,
                role: row.get(1)?,
                content: row.get(2)?,
                trace_json: row.get(3)?,
                stats_json: row.get(4)?,
                run_status: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|error| format!("could not query conversation messages: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not read conversation messages: {error}"))?;
    Ok(messages)
}

/// Resolve the display title: a real explicit (non-blank, non-placeholder) title
/// wins; otherwise derive one from the first user message; otherwise the
/// placeholder. The placeholder is ignored as an "explicit" title so a row that
/// had it persisted still derives from its first message.
fn resolve_title(explicit: Option<&str>, first_user_message: Option<&str>) -> String {
    if let Some(title) = explicit
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != NEW_CONVERSATION_TITLE)
    {
        return truncate_chars(title, TITLE_MAX_CHARS);
    }
    let derived = first_user_message.map(str::trim).unwrap_or("");
    if derived.is_empty() {
        return NEW_CONVERSATION_TITLE.to_owned();
    }
    truncate_chars(derived, TITLE_MAX_CHARS)
}

fn make_preview(first_message: Option<&str>) -> String {
    let trimmed = first_message.map(str::trim).unwrap_or("");
    truncate_chars(trimmed, PREVIEW_MAX_CHARS)
}

/// Truncate to at most `max` *characters* (not bytes), appending an ellipsis
/// when content was dropped. Char-boundary safe, no per-char allocation.
fn truncate_chars(text: &str, max: usize) -> String {
    let mut cut = None;
    for (count, (byte_index, _)) in text.char_indices().enumerate() {
        if count == max {
            cut = Some(byte_index);
            break;
        }
    }
    match cut {
        Some(byte_index) => format!("{}…", text[..byte_index].trim_end()),
        None => text.to_owned(),
    }
}

/// Decode the persisted `context_files_json` (a JSON string array) into the
/// file labels, tolerating null / malformed data as "no files".
fn parse_context_files(json: Option<&str>) -> Vec<String> {
    json.and_then(|value| serde_json::from_str::<Vec<String>>(value).ok())
        .unwrap_or_default()
}

/// Add any of `columns` — each `(name, full ALTER ddl)` — that `table` is
/// missing. SQLite has no "add column if not exists", so inspect
/// `pragma table_info` and `ALTER` only the gaps; idempotent across reopens.
/// `table` is always a hardcoded literal here (never user input).
fn add_missing_columns(
    connection: &Connection,
    table: &str,
    columns: &[(&str, &str)],
) -> Result<(), String> {
    let mut existing = HashSet::new();
    {
        let mut statement = connection
            .prepare(&format!("pragma table_info({table})"))
            .map_err(|error| format!("could not inspect {table} schema: {error}"))?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|error| format!("could not read {table} schema: {error}"))?;
        for name in rows {
            existing.insert(
                name.map_err(|error| format!("could not decode column name: {error}"))?,
            );
        }
    }
    for (column, ddl) in columns {
        if !existing.contains(*column) {
            connection
                .execute(ddl, [])
                .map_err(|error| format!("could not add {table}.{column}: {error}"))?;
        }
    }
    Ok(())
}

/// Idempotently bring existing `conversations` / `conversation_messages` tables
/// up to the current schema (the columns later builds added), then (re)create
/// the indexes that reference the newer columns. Called once from
/// `migrate_vault_database` after the `create table if not exists` batch.
pub(super) fn ensure_conversation_columns(connection: &Connection) -> Result<(), String> {
    add_missing_columns(
        connection,
        "conversations",
        &[
            ("deleted_at", "alter table conversations add column deleted_at integer"),
            ("last_opened_at", "alter table conversations add column last_opened_at integer"),
            ("context_files_json", "alter table conversations add column context_files_json text"),
        ],
    )?;
    // conversation_messages gained run_status for interrupted-run detection:
    // a reply left "streaming" on disk means its run never finished.
    add_missing_columns(
        connection,
        "conversation_messages",
        &[("run_status", "alter table conversation_messages add column run_status text")],
    )?;

    connection
        .execute_batch(
            "create index if not exists idx_conversations_list
               on conversations(updated_at desc)
               where deleted_at is null;
             create index if not exists idx_conversations_open
               on conversations(last_opened_at desc)
               where archived_at is null and deleted_at is null;",
        )
        .map_err(|error| format!("could not create conversation indexes: {error}"))?;
    Ok(())
}

// --- Tauri command wrappers ------------------------------------------------
// Thin IPC glue: every command is `(async)` so its blocking SQLite body runs
// off the UI thread (see docs/ipc-guide.md). Registered in lib.rs as
// `db::conversations::conversation_*`.

#[tauri::command(async)]
pub fn conversation_list(
    workspace_id: String,
    include_archived: bool,
    store: State<'_, MetadataStore>,
) -> Result<Vec<ConversationSummary>, String> {
    store.list_conversations(&workspace_id, include_archived)
}

#[tauri::command(async)]
pub fn conversation_load_active(
    workspace_id: String,
    store: State<'_, MetadataStore>,
) -> Result<Option<ConversationSnapshot>, String> {
    store.load_active_conversation(&workspace_id)
}

#[tauri::command(async)]
pub fn conversation_load(
    workspace_id: String,
    conversation_id: String,
    store: State<'_, MetadataStore>,
) -> Result<Option<ConversationSnapshot>, String> {
    store.load_conversation(&workspace_id, &conversation_id)
}

#[tauri::command(async)]
pub fn conversation_save(
    workspace_id: String,
    conversation_id: String,
    messages: Vec<ConversationMessageRecord>,
    context_files: Vec<String>,
    store: State<'_, MetadataStore>,
) -> Result<(), String> {
    store.save_conversation(&workspace_id, &conversation_id, messages, context_files)
}

#[tauri::command(async)]
pub fn conversation_new(
    workspace_id: String,
    harness_id: String,
    store: State<'_, MetadataStore>,
) -> Result<String, String> {
    store.new_conversation(&workspace_id, &harness_id)
}

#[tauri::command(async)]
pub fn conversation_rename(
    workspace_id: String,
    conversation_id: String,
    title: Option<String>,
    store: State<'_, MetadataStore>,
) -> Result<(), String> {
    store.rename_conversation(&workspace_id, &conversation_id, title)
}

#[tauri::command(async)]
pub fn conversation_archive(
    workspace_id: String,
    conversation_id: String,
    archived: bool,
    store: State<'_, MetadataStore>,
) -> Result<(), String> {
    store.set_conversation_archived(&workspace_id, &conversation_id, archived)
}

#[tauri::command(async)]
pub fn conversation_delete(
    workspace_id: String,
    conversation_id: String,
    store: State<'_, MetadataStore>,
) -> Result<(), String> {
    store.delete_conversation(&workspace_id, &conversation_id)
}

#[tauri::command(async)]
pub fn conversation_duplicate(
    workspace_id: String,
    conversation_id: String,
    store: State<'_, MetadataStore>,
) -> Result<String, String> {
    store.duplicate_conversation(&workspace_id, &conversation_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::tempdir;

    #[test]
    fn resolve_title_ignores_placeholder_and_derives_from_first_message() {
        // A real explicit title wins.
        assert_eq!(resolve_title(Some("My chat"), Some("hello")), "My chat");
        // The placeholder is reserved — never treated as an explicit title, so a
        // row that had it persisted still derives from its first message.
        assert_eq!(
            resolve_title(Some(NEW_CONVERSATION_TITLE), Some("Summarize this file")),
            "Summarize this file",
        );
        // Nothing to derive → placeholder.
        assert_eq!(resolve_title(None, None), NEW_CONVERSATION_TITLE);
        assert_eq!(resolve_title(Some("   "), None), NEW_CONVERSATION_TITLE);
    }

    fn store() -> (tempfile::TempDir, MetadataStore, &'static str) {
        let dir = tempdir().expect("temp dir");
        let store = MetadataStore::default();
        store.init_from_dir(dir.path()).expect("init metadata");
        store
            .ensure_vault("vault-1", "Research", Path::new("/tmp/research"))
            .expect("ensure vault");
        (dir, store, "vault-1")
    }

    fn message(id: &str, role: &str, content: &str) -> ConversationMessageRecord {
        ConversationMessageRecord {
            message_id: id.to_owned(),
            role: role.to_owned(),
            content: content.to_owned(),
            trace_json: None,
            stats_json: None,
            run_status: None,
            created_at: 10,
        }
    }

    #[test]
    fn save_and_load_round_trips_trace_stats_and_context() {
        let (_dir, store, vault) = store();
        let id = store.new_conversation(vault, "bob").expect("new conversation");

        let user = message("m1", "user", "what is this about?");
        let assistant = ConversationMessageRecord {
            trace_json: Some(r#"[{"kind":"tool","tool":{"id":"t1","name":"read_file","status":"done"}}]"#.to_owned()),
            stats_json: Some(r#"{"totalTokens":21956,"coins":0.05}"#.to_owned()),
            run_status: Some("interrupted".to_owned()),
            ..message("m2", "assistant", "It's a relocation plan.")
        };
        store
            .save_conversation(
                vault,
                &id,
                vec![user, assistant],
                vec!["notes/plan.md".to_owned()],
            )
            .expect("save conversation");

        let loaded = store
            .load_active_conversation(vault)
            .expect("load")
            .expect("an active conversation");
        assert_eq!(loaded.conversation_id, id);
        assert_eq!(loaded.harness_id.as_deref(), Some("bob"));
        assert_eq!(loaded.context_files, vec!["notes/plan.md".to_owned()]);
        assert_eq!(loaded.messages.len(), 2);
        assert_eq!(loaded.messages[0].content, "what is this about?");
        assert_eq!(loaded.messages[1].role, "assistant");
        assert!(loaded.messages[1].trace_json.as_deref().unwrap().contains("read_file"));
        assert_eq!(
            loaded.messages[1].stats_json.as_deref(),
            Some(r#"{"totalTokens":21956,"coins":0.05}"#)
        );
        assert_eq!(loaded.messages[1].run_status.as_deref(), Some("interrupted"));
    }

    #[test]
    fn save_conversation_replaces_the_message_set() {
        let (_dir, store, vault) = store();
        let id = store.new_conversation(vault, "bob").expect("new conversation");
        store
            .save_conversation(vault, &id, vec![message("m1", "user", "first")], vec![])
            .expect("save 1");
        store
            .save_conversation(
                vault,
                &id,
                vec![
                    message("m1", "user", "first"),
                    message("m2", "assistant", "answer"),
                ],
                vec![],
            )
            .expect("save 2");
        let loaded = store
            .load_active_conversation(vault)
            .expect("load")
            .expect("active");
        assert_eq!(loaded.messages.len(), 2);
    }

    #[test]
    fn new_conversation_does_not_archive_the_prior_active_one() {
        let (_dir, store, vault) = store();
        let first = store.new_conversation(vault, "bob").expect("first");
        store
            .save_conversation(vault, &first, vec![message("m1", "user", "hi")], vec![])
            .expect("save first");

        let second = store.new_conversation(vault, "claude").expect("second");

        // The newest conversation is active (most-recently-opened)…
        let loaded = store
            .load_active_conversation(vault)
            .expect("load")
            .expect("active");
        assert_eq!(loaded.conversation_id, second);
        assert_eq!(loaded.harness_id.as_deref(), Some("claude"));
        assert!(loaded.messages.is_empty());

        // …but the prior one is NOT archived — both show in the list.
        let list = store.list_conversations(vault, false).expect("list");
        let ids: Vec<&str> = list.iter().map(|c| c.conversation_id.as_str()).collect();
        assert!(ids.contains(&first.as_str()));
        assert!(ids.contains(&second.as_str()));
        assert!(list.iter().all(|c| !c.archived));
    }

    #[test]
    fn load_active_conversation_is_none_when_empty() {
        let (_dir, store, vault) = store();
        assert!(store
            .load_active_conversation(vault)
            .expect("load")
            .is_none());
    }

    #[test]
    fn open_bumps_last_opened_and_changes_the_active_one() {
        let (_dir, store, vault) = store();
        let first = store.new_conversation(vault, "bob").expect("first");
        let second = store.new_conversation(vault, "bob").expect("second");

        // `second` is newest, so it's active by default.
        assert_eq!(
            store.load_active_conversation(vault).unwrap().unwrap().conversation_id,
            second
        );

        // Opening `first` bumps its last_opened_at; it becomes active.
        let opened = store
            .load_conversation(vault, &first)
            .expect("open")
            .expect("found");
        assert_eq!(opened.conversation_id, first);
        assert_eq!(
            store.load_active_conversation(vault).unwrap().unwrap().conversation_id,
            first
        );
    }

    #[test]
    fn list_derives_title_and_preview_and_counts_messages() {
        let (_dir, store, vault) = store();
        let id = store.new_conversation(vault, "bob").expect("new");
        store
            .save_conversation(
                vault,
                &id,
                vec![
                    message("m1", "user", "  Plan the Q3 relocation across three offices  "),
                    message("m2", "assistant", "Sure, here's a plan."),
                ],
                vec!["a.md".to_owned(), "b.md".to_owned()],
            )
            .expect("save");

        let list = store.list_conversations(vault, false).expect("list");
        assert_eq!(list.len(), 1);
        let summary = &list[0];
        assert_eq!(summary.title, "Plan the Q3 relocation across three offices");
        assert_eq!(summary.preview, "Plan the Q3 relocation across three offices");
        assert_eq!(summary.message_count, 2);
        assert_eq!(summary.context_files, vec!["a.md".to_owned(), "b.md".to_owned()]);
        assert!(!summary.archived);
    }

    #[test]
    fn empty_conversation_titles_fall_back() {
        let (_dir, store, vault) = store();
        let id = store.new_conversation(vault, "bob").expect("new");
        let list = store.list_conversations(vault, false).expect("list");
        assert_eq!(list.iter().find(|c| c.conversation_id == id).unwrap().title, "New conversation");
    }

    #[test]
    fn long_titles_are_truncated_on_char_boundaries() {
        let (_dir, store, vault) = store();
        let id = store.new_conversation(vault, "bob").expect("new");
        let long = "x".repeat(200);
        store
            .save_conversation(vault, &id, vec![message("m1", "user", &long)], vec![])
            .expect("save");
        let list = store.list_conversations(vault, false).expect("list");
        let summary = list.iter().find(|c| c.conversation_id == id).unwrap();
        // 60 chars + ellipsis.
        assert_eq!(summary.title.chars().count(), TITLE_MAX_CHARS + 1);
        assert!(summary.title.ends_with('…'));
        assert_eq!(summary.preview.chars().count(), PREVIEW_MAX_CHARS + 1);
    }

    #[test]
    fn rename_sets_explicit_title_and_clears_to_derived() {
        let (_dir, store, vault) = store();
        let id = store.new_conversation(vault, "bob").expect("new");
        store
            .save_conversation(vault, &id, vec![message("m1", "user", "derived from this")], vec![])
            .expect("save");

        store
            .rename_conversation(vault, &id, Some("My Title".to_owned()))
            .expect("rename");
        let list = store.list_conversations(vault, false).expect("list");
        assert_eq!(list.iter().find(|c| c.conversation_id == id).unwrap().title, "My Title");

        // Clearing it (empty string) falls back to the derived title.
        store
            .rename_conversation(vault, &id, Some("   ".to_owned()))
            .expect("clear");
        let list = store.list_conversations(vault, false).expect("list");
        assert_eq!(
            list.iter().find(|c| c.conversation_id == id).unwrap().title,
            "derived from this"
        );
    }

    #[test]
    fn archive_hides_from_default_list_but_shows_in_archived() {
        let (_dir, store, vault) = store();
        let keep = store.new_conversation(vault, "bob").expect("keep");
        let filed = store.new_conversation(vault, "bob").expect("filed");

        store
            .set_conversation_archived(vault, &filed, true)
            .expect("archive");

        let default = store.list_conversations(vault, false).expect("default");
        assert!(default.iter().all(|c| c.conversation_id != filed));
        assert!(default.iter().any(|c| c.conversation_id == keep));

        let with_archived = store.list_conversations(vault, true).expect("with archived");
        let archived = with_archived
            .iter()
            .find(|c| c.conversation_id == filed)
            .expect("archived present");
        assert!(archived.archived);

        // Archiving the active one means the other becomes active.
        assert_eq!(
            store.load_active_conversation(vault).unwrap().unwrap().conversation_id,
            keep
        );

        // Un-archiving restores it to the default list.
        store
            .set_conversation_archived(vault, &filed, false)
            .expect("unarchive");
        let default = store.list_conversations(vault, false).expect("default");
        assert!(default.iter().any(|c| c.conversation_id == filed));
    }

    #[test]
    fn soft_delete_hides_from_all_lists_and_active() {
        let (_dir, store, vault) = store();
        let keep = store.new_conversation(vault, "bob").expect("keep");
        let gone = store.new_conversation(vault, "bob").expect("gone");

        store.delete_conversation(vault, &gone).expect("delete");

        let default = store.list_conversations(vault, false).expect("default");
        assert!(default.iter().all(|c| c.conversation_id != gone));
        let with_archived = store.list_conversations(vault, true).expect("with archived");
        assert!(with_archived.iter().all(|c| c.conversation_id != gone));

        // It can't be opened, and the surviving one is active.
        assert!(store.load_conversation(vault, &gone).expect("load").is_none());
        assert_eq!(
            store.load_active_conversation(vault).unwrap().unwrap().conversation_id,
            keep
        );
    }

    #[test]
    fn duplicate_copies_row_and_messages_with_fresh_ids() {
        let (_dir, store, vault) = store();
        let id = store.new_conversation(vault, "bob").expect("new");
        store
            .rename_conversation(vault, &id, Some("Original".to_owned()))
            .expect("rename");
        store
            .save_conversation(
                vault,
                &id,
                vec![
                    message("m1", "user", "question"),
                    message("m2", "assistant", "answer"),
                ],
                vec!["ctx.md".to_owned()],
            )
            .expect("save");

        let copy_id = store.duplicate_conversation(vault, &id).expect("duplicate");
        assert_ne!(copy_id, id);

        let copy = store
            .load_conversation(vault, &copy_id)
            .expect("load copy")
            .expect("copy exists");
        assert_eq!(copy.messages.len(), 2);
        assert_eq!(copy.messages[0].content, "question");
        assert_eq!(copy.context_files, vec!["ctx.md".to_owned()]);
        // Message ids are regenerated, not shared with the source.
        assert_ne!(copy.messages[0].message_id, "m1");

        let list = store.list_conversations(vault, false).expect("list");
        let copy_summary = list.iter().find(|c| c.conversation_id == copy_id).unwrap();
        assert_eq!(copy_summary.title, "Original (copy)");
        // The original survives untouched.
        assert!(list.iter().any(|c| c.conversation_id == id));
    }

    #[test]
    fn migration_is_idempotent_across_reopens() {
        let (_dir, store, vault) = store();
        // Re-opening the vault re-runs migrate_vault_database (incl.
        // ensure_conversation_columns); a second new_conversation must still
        // work, proving the guarded ALTERs don't fail on already-present
        // columns.
        let first = store.new_conversation(vault, "bob").expect("first");
        let second = store.new_conversation(vault, "bob").expect("second");
        assert_ne!(first, second);
        assert_eq!(store.list_conversations(vault, false).expect("list").len(), 2);
    }
}
