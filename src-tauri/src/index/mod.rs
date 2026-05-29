//! Workspace index — the Tauri-side shell.
//!
//! The *logic* (parsing headings/tags/frontmatter/links, building the
//! snapshot, searching it) lives in the pure `workspace-index` crate so
//! the browser can run the exact same code compiled to WASM. This module
//! is the platform shell: it scans the real folder off disk, calls the
//! core, mirrors the result into SQLite for durable search metadata, and
//! caches the snapshot in memory for `workspace_search_index`.

use crate::db::{
    self, MetadataStore, SearchBacklinkRecord, SearchFrontmatterRecord, SearchGraphEdgeRecord,
    SearchIndexRecords, SearchTagRecord,
};
use crate::files::{document_inventory_for_entries, ensure_vault_metadata, scan_markdown_files};
use crate::workspace::WorkspaceRegistry;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;
use tauri::State;
use workspace_index::{build_snapshot, search_snapshot, title_from_markdown};

// Re-export the index/search types so `crate::index::Foo` keeps resolving
// from one place — they now live in the shared `workspace-index` crate.
pub use workspace_index::{
    BacklinkRecord, FrontmatterRecord, GraphEdgeRecord, IndexedDocument, LinkKind, SearchHit,
    TagKind, TagRecord, WorkspaceIndexSnapshot,
};

#[derive(Default)]
pub struct WorkspaceIndexStore {
    snapshots: Mutex<HashMap<String, WorkspaceIndexSnapshot>>,
}

#[tauri::command(async)]
pub fn workspace_rebuild_index(
    workspace_id: String,
    registry: State<'_, WorkspaceRegistry>,
    metadata: State<'_, MetadataStore>,
    store: State<'_, WorkspaceIndexStore>,
) -> Result<WorkspaceIndexSnapshot, String> {
    let started = Instant::now();
    let root = registry.workspace_root(&workspace_id)?;
    let entries = scan_markdown_files(&root).map_err(file_error_message)?;
    ensure_vault_metadata(&metadata, &workspace_id, &root).map_err(file_error_message)?;
    let inventory = document_inventory_for_entries(&root, &entries).map_err(file_error_message)?;
    metadata.sync_documents(&workspace_id, inventory)?;
    let doc_ids = metadata.document_ids_by_path(&workspace_id)?;
    let mut documents = Vec::with_capacity(entries.len());

    for entry in entries {
        let absolute = root.join(&entry.relative_path);
        let content = std::fs::read_to_string(&absolute).map_err(|error| {
            format!(
                "could not read {} for indexing: {error}",
                entry.relative_path
            )
        })?;
        let doc_id = doc_ids
            .get(&entry.relative_path)
            .cloned()
            .ok_or_else(|| format!("{} is missing document metadata", entry.relative_path))?;
        // Title + content hash are computed here (rather than in the core)
        // so the desktop snapshot keeps using the app's SHA-256 hash and
        // the same title fallback it always has — no behavior change.
        let title = title_from_markdown(&content)
            .or_else(|| db::title_from_path(&entry.relative_path))
            .unwrap_or_else(|| entry.relative_path.clone());
        documents.push(IndexedDocument::new(
            doc_id,
            entry.relative_path.clone(),
            title,
            db::content_hash(&content),
            content,
        ));
    }

    let snapshot = build_snapshot(
        workspace_id,
        documents,
        started.elapsed().as_millis(),
        now_ms(),
    );
    metadata.replace_search_index_records(
        &snapshot.workspace_id,
        metadata_records_for_snapshot(&snapshot),
    )?;
    store.insert(snapshot.clone())?;
    Ok(snapshot)
}

#[tauri::command(async)]
pub fn workspace_index_snapshot(
    workspace_id: String,
    store: State<'_, WorkspaceIndexStore>,
) -> Result<Option<WorkspaceIndexSnapshot>, String> {
    store.get(&workspace_id)
}

#[tauri::command(async)]
pub fn workspace_search_index(
    workspace_id: String,
    query: String,
    limit: Option<usize>,
    store: State<'_, WorkspaceIndexStore>,
) -> Result<Vec<SearchHit>, String> {
    let snapshot = store
        .get(&workspace_id)?
        .ok_or_else(|| "workspace index has not been built".to_owned())?;
    Ok(search_snapshot(&snapshot, &query, limit.unwrap_or(20)))
}

impl WorkspaceIndexStore {
    fn insert(&self, snapshot: WorkspaceIndexSnapshot) -> Result<(), String> {
        self.snapshots
            .lock()
            .map_err(|_| "workspace index lock was poisoned".to_owned())?
            .insert(snapshot.workspace_id.clone(), snapshot);
        Ok(())
    }

    fn get(&self, workspace_id: &str) -> Result<Option<WorkspaceIndexSnapshot>, String> {
        Ok(self
            .snapshots
            .lock()
            .map_err(|_| "workspace index lock was poisoned".to_owned())?
            .get(workspace_id)
            .cloned())
    }
}

/// Map a snapshot into the flat SQLite mirror DTOs. This is the only part
/// that knows about the persistence layer, which is why it stays here and
/// not in the pure core.
fn metadata_records_for_snapshot(snapshot: &WorkspaceIndexSnapshot) -> SearchIndexRecords {
    SearchIndexRecords {
        backlinks: snapshot
            .backlinks
            .iter()
            .map(|backlink| SearchBacklinkRecord {
                kind: link_kind_name(backlink.kind).to_owned(),
                label: backlink.label.clone(),
                source_doc_id: backlink.source_doc_id.clone(),
                source_path: backlink.source_path.clone(),
                source_range: backlink.source_range.clone(),
                target_doc_id: backlink.target_doc_id.clone(),
                target_path: backlink.target_path.clone(),
            })
            .collect(),
        frontmatter: snapshot
            .frontmatter
            .iter()
            .map(|frontmatter| SearchFrontmatterRecord {
                doc_id: frontmatter.doc_id.clone(),
                key: frontmatter.key.clone(),
                path: frontmatter.path.clone(),
                source_range: frontmatter.source_range.clone(),
                value: frontmatter.value.clone(),
            })
            .collect(),
        graph_edges: snapshot
            .graph_edges
            .iter()
            .map(|edge| SearchGraphEdgeRecord {
                from_doc_id: edge.from_doc_id.clone(),
                from_path: edge.from_path.clone(),
                kind: link_kind_name(edge.kind).to_owned(),
                source_range: edge.source_range.clone(),
                to_doc_id: edge.to_doc_id.clone(),
                to_path: edge.to_path.clone(),
            })
            .collect(),
        tags: snapshot
            .tags
            .iter()
            .map(|tag| SearchTagRecord {
                doc_id: tag.doc_id.clone(),
                kind: tag_kind_name(tag.kind).to_owned(),
                path: tag.path.clone(),
                source_range: tag.source_range.clone(),
                tag: tag.tag.clone(),
            })
            .collect(),
    }
}

fn link_kind_name(kind: LinkKind) -> &'static str {
    match kind {
        LinkKind::Markdown => "markdown",
        LinkKind::Wikilink => "wikilink",
    }
}

fn tag_kind_name(kind: TagKind) -> &'static str {
    match kind {
        TagKind::Frontmatter => "frontmatter",
        TagKind::Inline => "inline",
    }
}

fn file_error_message(error: crate::files::FileError) -> String {
    match error {
        crate::files::FileError::AlreadyExists { message }
        | crate::files::FileError::Message { message }
        | crate::files::FileError::NotFound { message } => message,
        crate::files::FileError::Conflict {
            latest_last_modified_ms,
        } => format!("file changed on disk at {latest_last_modified_ms}"),
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
