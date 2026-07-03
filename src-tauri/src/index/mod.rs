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
use crate::files::{
    document_inventory_for_entries, ensure_vault_metadata, icloud, scan_markdown_files,
};
use crate::workspace::WorkspaceRegistry;
use std::collections::{HashMap, HashSet};
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

/// Stable error string for a rebuild declined because one is already running.
/// The frontend matches on it to keep showing "indexing" rather than "failed".
pub const INDEX_BUILD_IN_PROGRESS: &str = "workspace index build already in progress";

#[derive(Default)]
pub struct WorkspaceIndexStore {
    snapshots: Mutex<HashMap<String, WorkspaceIndexSnapshot>>,
    building: Mutex<HashSet<String>>,
}

/// Releases a workspace's build slot when the rebuild leaves scope — success,
/// error, or panic all free the slot, so a failed build can't lock a
/// workspace out of indexing until restart.
struct BuildSlot<'store> {
    store: &'store WorkspaceIndexStore,
    workspace_id: String,
}

impl Drop for BuildSlot<'_> {
    fn drop(&mut self) {
        if let Ok(mut building) = self.store.building.lock() {
            building.remove(&self.workspace_id);
        }
    }
}

#[tauri::command(async)]
pub fn workspace_rebuild_index(
    workspace_id: String,
    registry: State<'_, WorkspaceRegistry>,
    metadata: State<'_, MetadataStore>,
    store: State<'_, WorkspaceIndexStore>,
) -> Result<WorkspaceIndexSnapshot, String> {
    // Single-flight per workspace (#106): rebuilds are triggered from many
    // places (every save/rename/delete, watcher events, opening search) and a
    // crawl over a big vault takes real time — concurrent rebuilds multiply
    // the I/O and contend on the metadata store that history and saves need.
    let _slot = store.begin_build(&workspace_id)?;
    let started = Instant::now();
    let root = registry.workspace_root(&workspace_id)?;
    let entries = scan_markdown_files(&root).map_err(file_error_message)?;
    ensure_vault_metadata(&metadata, &workspace_id, &root).map_err(file_error_message)?;
    let inventory = document_inventory_for_entries(&root, &entries);
    if !inventory.skipped.is_empty() {
        eprintln!(
            "workspace index ({workspace_id}): inventory skipped {} unreadable file(s) (e.g. dataless iCloud notes)",
            inventory.skipped.len()
        );
    }
    metadata.sync_documents_retaining(&workspace_id, inventory.entries, &inventory.skipped)?;
    let doc_ids = metadata.document_ids_by_path(&workspace_id)?;
    let mut documents = Vec::with_capacity(entries.len());
    let mut skipped = 0usize;

    for entry in entries {
        let absolute = root.join(&entry.relative_path);
        // Never read a dataless iCloud placeholder: the read BLOCKS while the
        // bytes download (it does not fail fast), turning the rebuild into a
        // network crawl (#106). Skip it, nudge the download, and let a later
        // rebuild index it once local.
        if icloud::is_dataless(&absolute) {
            icloud::start_download(&absolute);
            skipped += 1;
            continue;
        }
        // A single unreadable or non-UTF-8 file (a binary mis-named `.md`, a
        // permission glitch), or a doc with no metadata row yet, must not sink
        // the whole index — skip it and keep going. Aborting here left search
        // silently disabled for an entire workspace over one bad file.
        let Ok(content) = std::fs::read_to_string(&absolute) else {
            skipped += 1;
            continue;
        };
        let Some(doc_id) = doc_ids.get(&entry.relative_path).cloned() else {
            skipped += 1;
            continue;
        };
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
    if skipped > 0 {
        eprintln!("workspace index ({workspace_id}): skipped {skipped} unreadable or unmapped file(s)");
    }

    let snapshot = build_snapshot(
        workspace_id,
        documents,
        started.elapsed().as_millis(),
        now_ms(),
    );
    // Cache the in-memory snapshot FIRST — search reads this, not the SQLite
    // mirror — so a mirror-write failure can't leave search disabled.
    store.insert(snapshot.clone())?;
    if let Err(error) = metadata.replace_search_index_records(
        &snapshot.workspace_id,
        metadata_records_for_snapshot(&snapshot),
    ) {
        eprintln!(
            "workspace index ({}): search-metadata mirror write failed: {error}",
            snapshot.workspace_id
        );
    }
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
    /// Claim the workspace's build slot, or decline with
    /// [`INDEX_BUILD_IN_PROGRESS`] when a build already holds it.
    fn begin_build(&self, workspace_id: &str) -> Result<BuildSlot<'_>, String> {
        let mut building = self
            .building
            .lock()
            .map_err(|_| "workspace index lock was poisoned".to_owned())?;
        if !building.insert(workspace_id.to_owned()) {
            return Err(INDEX_BUILD_IN_PROGRESS.to_owned());
        }
        Ok(BuildSlot {
            store: self,
            workspace_id: workspace_id.to_owned(),
        })
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_build_is_declined_while_the_first_holds_the_slot() {
        let store = WorkspaceIndexStore::default();
        let slot = store.begin_build("ws-1").expect("first build claims");
        let declined = match store.begin_build("ws-1") {
            Ok(_) => panic!("second concurrent build must be declined"),
            Err(message) => message,
        };
        assert_eq!(declined, INDEX_BUILD_IN_PROGRESS);
        drop(slot);
        store
            .begin_build("ws-1")
            .expect("slot frees when the build ends");
    }

    #[test]
    fn workspaces_build_independently() {
        let store = WorkspaceIndexStore::default();
        let _one = store.begin_build("ws-1").expect("ws-1 claims");
        store
            .begin_build("ws-2")
            .expect("another workspace is unaffected");
    }

    #[test]
    fn a_panicking_build_frees_its_slot() {
        let store = std::sync::Arc::new(WorkspaceIndexStore::default());
        let for_thread = store.clone();
        let _ = std::thread::spawn(move || {
            let _slot = for_thread.begin_build("ws-1").expect("claims");
            panic!("build blew up");
        })
        .join();
        store
            .begin_build("ws-1")
            .expect("slot released despite the panic");
    }
}
