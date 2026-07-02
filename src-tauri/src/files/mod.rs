use crate::db::{self, DocumentInventoryEntry, MetadataStore};
use crate::workspace::WorkspaceRegistry;
use serde::Serialize;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};
use walkdir::WalkDir;

pub mod clone;
pub mod diff;
pub(crate) mod icloud;
pub mod starter;
pub mod trash;
pub mod trash_sweep;
pub mod watcher;

#[cfg(test)]
mod ipc_tests;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileEntry {
    pub last_modified_ms: i64,
    pub relative_path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFileContent {
    pub content: String,
    pub last_modified_ms: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWriteResult {
    pub last_modified_ms: i64,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileError {
    Conflict { latest_last_modified_ms: i64 },
    NotFound { message: String },
    AlreadyExists { message: String },
    Message { message: String },
}

impl std::fmt::Display for FileError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FileError::Conflict { .. } => {
                write!(formatter, "the file changed on disk since it was loaded")
            }
            FileError::NotFound { message }
            | FileError::AlreadyExists { message }
            | FileError::Message { message } => write!(formatter, "{message}"),
        }
    }
}

impl From<String> for FileError {
    fn from(message: String) -> Self {
        Self::Message { message }
    }
}

impl From<&str> for FileError {
    fn from(message: &str) -> Self {
        Self::Message {
            message: message.to_owned(),
        }
    }
}

impl From<std::io::Error> for FileError {
    fn from(error: std::io::Error) -> Self {
        if error.kind() == std::io::ErrorKind::NotFound {
            return Self::NotFound {
                message: error.to_string(),
            };
        }
        Self::Message {
            message: error.to_string(),
        }
    }
}

#[tauri::command(async)]
pub fn workspace_scan(
    workspace_id: String,
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    metadata: State<'_, MetadataStore>,
    watchers: State<'_, watcher::WatcherManager>,
) -> Result<Vec<WorkspaceFileEntry>, FileError> {
    let root = registry.workspace_root(&workspace_id)?;
    // Opening a workspace makes its files (notably pasted images under
    // `images/`) servable to the webview via the `asset:` protocol, so the
    // editor can display them. The markdown keeps workspace-relative paths;
    // resolution to an asset URL happens at display time on the front end. The
    // scope is additive and per-workspace — only folders the user has opened
    // are ever exposed. A scope failure must not block the scan.
    if let Err(error) = app.asset_protocol_scope().allow_directory(&root, true) {
        eprintln!("asset scope allow failed for {workspace_id}: {error}");
    }
    let entries = scan_markdown_files(&root)?;
    ensure_vault_metadata(&metadata, &workspace_id, &root)?;
    if let Err(message) = watchers.ensure_watcher(&workspace_id, &root) {
        eprintln!("watcher failed to start for {workspace_id}: {message}");
    }
    // Build the content-hash inventory off the scan's critical path. It reads
    // every note's bytes (`std::fs::read`), which materializes dataless iCloud
    // files and made a large vault take tens of seconds — but the file tree only
    // needs the directory walk above. Return the entries now and let the
    // search/metadata inventory catch up on its own thread.
    {
        let app = app.clone();
        let workspace_id = workspace_id.clone();
        let root = root.clone();
        let entries = entries.clone();
        std::thread::spawn(move || {
            let metadata = app.state::<MetadataStore>();
            let inventory = document_inventory_for_entries(&root, &entries);
            if let Err(error) =
                metadata.sync_documents_retaining(&workspace_id, inventory.entries, &inventory.skipped)
            {
                eprintln!("inventory sync failed for {workspace_id}: {error}");
            }
        });
    }
    Ok(entries)
}

/// The workspace's directories (relative paths), so the tree can show folders
/// that hold no markdown file yet — `workspace_scan` only surfaces `.md` files.
#[tauri::command(async)]
pub fn workspace_scan_folders(
    workspace_id: String,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<Vec<String>, FileError> {
    let root = registry.workspace_root(&workspace_id)?;
    scan_folders(&root)
}

/// Create an empty directory in the workspace (a real "New folder").
#[tauri::command(async)]
pub fn workspace_create_folder(
    workspace_id: String,
    relative_path: String,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<(), FileError> {
    create_folder(&registry, &workspace_id, &relative_path)
}

#[tauri::command(async)]
pub fn workspace_read_file(
    workspace_id: String,
    relative_path: String,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<WorkspaceFileContent, FileError> {
    read_file(&registry, &workspace_id, &relative_path)
}

#[tauri::command(async)]
pub fn workspace_write_file(
    workspace_id: String,
    relative_path: String,
    content: String,
    expected_last_modified_ms: Option<i64>,
    changes: Vec<db::DocumentTextChange>,
    registry: State<'_, WorkspaceRegistry>,
    metadata: State<'_, MetadataStore>,
) -> Result<WorkspaceWriteResult, FileError> {
    let root = registry.workspace_root(&workspace_id)?;
    ensure_vault_metadata(&metadata, &workspace_id, &root)?;
    let base = if changes.is_empty() {
        read_file(&registry, &workspace_id, &relative_path).ok()
    } else {
        let base = read_file(&registry, &workspace_id, &relative_path)?;
        db::validate_document_transaction(&base.content, &content, &changes)?;
        Some(base)
    };
    let result = write_file(
        &registry,
        &workspace_id,
        &relative_path,
        &content,
        expected_last_modified_ms,
    )?;
    if changes.is_empty() {
        metadata.record_document_written(
            &workspace_id,
            &relative_path,
            &content,
            result.last_modified_ms,
            content.len() as u64,
        )?;
    } else {
        let base = base.ok_or_else(|| FileError::Message {
            message: "cannot record document transaction without an existing base file".to_owned(),
        })?;
        metadata.record_document_transaction(
            &workspace_id,
            &relative_path,
            db::DocumentEdit {
                base_text: &base.content,
                resulting_text: &content,
                changes,
            },
            result.last_modified_ms,
            content.len() as u64,
        )?;
    }
    Ok(result)
}

#[tauri::command(async)]
pub fn workspace_create_file(
    workspace_id: String,
    relative_path: String,
    content: String,
    registry: State<'_, WorkspaceRegistry>,
    metadata: State<'_, MetadataStore>,
) -> Result<WorkspaceWriteResult, FileError> {
    let root = registry.workspace_root(&workspace_id)?;
    ensure_vault_metadata(&metadata, &workspace_id, &root)?;
    let result = create_file(&registry, &workspace_id, &relative_path, &content)?;
    metadata.record_document_written(
        &workspace_id,
        &relative_path,
        &content,
        result.last_modified_ms,
        content.len() as u64,
    )?;
    Ok(result)
}

/// Write raw bytes to a workspace file, atomically. This is the seam for the
/// image-insert pipeline (paste / drag-and-drop): the front end decodes the
/// pasted or dropped image and hands us the bytes plus a workspace-relative
/// path under `images/`, and we land them on disk so the markdown can
/// reference a real file rather than inlining a data URL.
///
/// Deliberately records **no** document-inventory entry. The inventory and its
/// version history are text-document concepts — revisions store UTF-8
/// snapshots, titles, and the search index — and `workspace_scan` only ever
/// surfaces `.md` files, so a binary row there would be marked deleted on the
/// very next scan (`sync_documents` deletes everything the scan didn't see).
/// We still `ensure_vault_metadata` so this command initialises the vault
/// consistently with its text siblings.
#[tauri::command(async)]
pub fn workspace_write_binary_file(
    workspace_id: String,
    relative_path: String,
    bytes: Vec<u8>,
    registry: State<'_, WorkspaceRegistry>,
    metadata: State<'_, MetadataStore>,
) -> Result<WorkspaceWriteResult, FileError> {
    let root = registry.workspace_root(&workspace_id)?;
    ensure_vault_metadata(&metadata, &workspace_id, &root)?;
    write_binary_file(&registry, &workspace_id, &relative_path, &bytes)
}

#[tauri::command(async)]
pub fn workspace_rename_file(
    workspace_id: String,
    from_relative: String,
    to_relative: String,
    registry: State<'_, WorkspaceRegistry>,
    metadata: State<'_, MetadataStore>,
) -> Result<(), FileError> {
    let root = registry.workspace_root(&workspace_id)?;
    ensure_vault_metadata(&metadata, &workspace_id, &root)?;
    let existing = read_file(&registry, &workspace_id, &from_relative)?;
    metadata.record_document_written(
        &workspace_id,
        &from_relative,
        &existing.content,
        existing.last_modified_ms,
        existing.content.len() as u64,
    )?;
    rename_file(&registry, &workspace_id, &from_relative, &to_relative)?;
    metadata.rename_document(&workspace_id, &from_relative, &to_relative)?;
    Ok(())
}

#[tauri::command(async)]
pub fn workspace_delete_file(
    workspace_id: String,
    relative_path: String,
    registry: State<'_, WorkspaceRegistry>,
    metadata: State<'_, MetadataStore>,
) -> Result<(), FileError> {
    let root = registry.workspace_root(&workspace_id)?;
    ensure_vault_metadata(&metadata, &workspace_id, &root)?;
    soft_delete(&registry, &metadata, &workspace_id, &relative_path)
}

/// Move a folder (and everything under it) to the trash. Free-function core of
/// [`workspace_delete_folder`] — unit-testable without Tauri `State`, mirroring
/// how [`soft_delete`] backs `workspace_delete_file`.
fn delete_folder(
    registry: &WorkspaceRegistry,
    trash_root: &Path,
    workspace_id: &str,
    relative_path: &str,
) -> Result<(), FileError> {
    let absolute = registry.resolve_workspace_path(workspace_id, relative_path)?;
    if !absolute.is_dir() {
        return Err(FileError::NotFound {
            message: format!("{relative_path} is not a folder"),
        });
    }
    trash::move_to_trash(trash_root, workspace_id, &absolute)?;
    Ok(())
}

/// Move a folder and its contents to the trash — recoverable, like file delete.
/// The frontend prunes the tree/tabs/context/nav for every removed path.
#[tauri::command(async)]
pub fn workspace_delete_folder(
    workspace_id: String,
    relative_path: String,
    registry: State<'_, WorkspaceRegistry>,
    metadata: State<'_, MetadataStore>,
) -> Result<(), FileError> {
    let trash_root = metadata.trash_root()?;
    delete_folder(&registry, &trash_root, &workspace_id, &relative_path)
}

/// Recent restorable versions of a file (newest first). The live file's
/// content hash is computed here so the UI can flag which version is current.
#[tauri::command(async)]
pub fn workspace_list_versions(
    workspace_id: String,
    relative_path: String,
    limit: Option<u32>,
    registry: State<'_, WorkspaceRegistry>,
    metadata: State<'_, MetadataStore>,
) -> Result<Vec<db::DocumentVersion>, FileError> {
    let current_hash = read_file(&registry, &workspace_id, &relative_path)
        .ok()
        .map(|file| db::content_hash(&file.content));
    metadata
        .list_document_versions(
            &workspace_id,
            &relative_path,
            current_hash.as_deref(),
            limit.unwrap_or(50),
        )
        .map_err(FileError::from)
}

/// Restore a prior version of a file, writing it back atomically. The content
/// being overwritten is snapshotted first, so a restore is itself reversible.
/// Restoring a previously deleted file recreates it on disk.
#[tauri::command(async)]
pub fn workspace_restore_version(
    workspace_id: String,
    relative_path: String,
    revision_id: String,
    registry: State<'_, WorkspaceRegistry>,
    metadata: State<'_, MetadataStore>,
) -> Result<WorkspaceWriteResult, FileError> {
    let root = registry.workspace_root(&workspace_id)?;
    ensure_vault_metadata(&metadata, &workspace_id, &root)?;
    // Capture the current on-disk content first so this restore can itself be
    // undone. Absent (deleted) or non-text files simply skip the capture.
    if let Ok(current) = read_file(&registry, &workspace_id, &relative_path) {
        metadata.record_document_written(
            &workspace_id,
            &relative_path,
            &current.content,
            current.last_modified_ms,
            current.content.len() as u64,
        )?;
    }
    let content = metadata.document_version_content(&workspace_id, &relative_path, &revision_id)?;
    // The user explicitly chose this version — overwrite unconditionally.
    write_and_record(&registry, &metadata, &workspace_id, &relative_path, &content)
}

pub(crate) fn read_file(
    registry: &WorkspaceRegistry,
    workspace_id: &str,
    relative_path: &str,
) -> Result<WorkspaceFileContent, FileError> {
    let absolute = registry.resolve_workspace_path(workspace_id, relative_path)?;
    let content = match std::fs::read_to_string(&absolute) {
        Ok(content) => content,
        Err(error) => {
            // A dataless iCloud file (evicted locally) can fail to read; kick its
            // download so a reopen materializes it instead of leaving it stuck
            // blank (#26). Best-effort — a no-op for non-iCloud files.
            icloud::start_download(&absolute);
            return Err(error.into());
        }
    };
    let metadata = std::fs::metadata(&absolute)?;
    Ok(WorkspaceFileContent {
        content,
        last_modified_ms: mtime_ms(&metadata)?,
    })
}

pub(crate) fn write_file(
    registry: &WorkspaceRegistry,
    workspace_id: &str,
    relative_path: &str,
    content: &str,
    expected_last_modified_ms: Option<i64>,
) -> Result<WorkspaceWriteResult, FileError> {
    let absolute = registry.resolve_workspace_path(workspace_id, relative_path)?;

    if let Some(expected) = expected_last_modified_ms {
        if let Ok(metadata) = std::fs::metadata(&absolute) {
            let actual = mtime_ms(&metadata)?;
            if actual > expected {
                return Err(FileError::Conflict {
                    latest_last_modified_ms: actual,
                });
            }
        }
    }

    write_file_atomic(&absolute, content)?;
    let metadata = std::fs::metadata(&absolute)?;
    Ok(WorkspaceWriteResult {
        last_modified_ms: mtime_ms(&metadata)?,
    })
}

pub(crate) fn write_binary_file(
    registry: &WorkspaceRegistry,
    workspace_id: &str,
    relative_path: &str,
    bytes: &[u8],
) -> Result<WorkspaceWriteResult, FileError> {
    // `resolve_workspace_path` rejects traversal; `write_file_atomic` creates
    // the parent directory (e.g. `images/`) and writes through a temp file +
    // rename so a reader never observes a partially written image.
    let absolute = registry.resolve_workspace_path(workspace_id, relative_path)?;
    write_file_atomic(&absolute, bytes)?;
    let metadata = std::fs::metadata(&absolute)?;
    Ok(WorkspaceWriteResult {
        last_modified_ms: mtime_ms(&metadata)?,
    })
}

pub(crate) fn create_file(
    registry: &WorkspaceRegistry,
    workspace_id: &str,
    relative_path: &str,
    content: &str,
) -> Result<WorkspaceWriteResult, FileError> {
    let absolute = registry.resolve_workspace_path(workspace_id, relative_path)?;
    if absolute.exists() {
        return Err(FileError::AlreadyExists {
            message: format!("{relative_path} already exists"),
        });
    }
    if let Some(parent) = absolute.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&absolute, content)?;
    let metadata = std::fs::metadata(&absolute)?;
    Ok(WorkspaceWriteResult {
        last_modified_ms: mtime_ms(&metadata)?,
    })
}

pub(crate) fn create_folder(
    registry: &WorkspaceRegistry,
    workspace_id: &str,
    relative_path: &str,
) -> Result<(), FileError> {
    let absolute = registry.resolve_workspace_path(workspace_id, relative_path)?;
    if absolute.exists() {
        return Err(FileError::AlreadyExists {
            message: format!("{relative_path} already exists"),
        });
    }
    std::fs::create_dir_all(&absolute)?;
    Ok(())
}

pub(crate) fn rename_file(
    registry: &WorkspaceRegistry,
    workspace_id: &str,
    from_relative: &str,
    to_relative: &str,
) -> Result<(), FileError> {
    let from = registry.resolve_workspace_path(workspace_id, from_relative)?;
    let to = registry.resolve_workspace_path(workspace_id, to_relative)?;
    if !from.exists() {
        return Err(FileError::NotFound {
            message: format!("{from_relative} does not exist"),
        });
    }
    if to.exists() {
        return Err(FileError::AlreadyExists {
            message: format!("{to_relative} already exists"),
        });
    }
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::rename(&from, &to)?;
    Ok(())
}

pub(crate) fn scan_markdown_files(root: &Path) -> Result<Vec<WorkspaceFileEntry>, FileError> {
    let mut entries = Vec::new();
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            !is_ignored_segment(&name)
        });

    for entry in walker {
        let entry = match entry {
            Ok(value) => value,
            Err(error) => {
                // A read failure at the ROOT (depth 0) means the vault itself is
                // unreadable right now — an iCloud folder not yet materialized, a
                // permission hiccup, a relaunch racing the previous instance.
                // Surface it so the caller can retry, instead of returning an
                // empty list that reads as "no notes". A failure deeper in the
                // tree is one bad file: skip it so a single unreadable note can't
                // abort the whole scan.
                if error.depth() == 0 {
                    return Err(FileError::Message {
                        message: format!("could not read workspace root: {error}"),
                    });
                }
                continue;
            }
        };
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        let relative_path = path
            .strip_prefix(root)
            .map_err(|error| FileError::Message {
                message: error.to_string(),
            })?
            .to_string_lossy()
            .replace('\\', "/");
        let metadata = entry.metadata().map_err(|error| FileError::Message {
            message: error.to_string(),
        })?;
        entries.push(WorkspaceFileEntry {
            last_modified_ms: mtime_ms(&metadata)?,
            relative_path,
            size_bytes: metadata.len(),
        });
    }

    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(entries)
}

/// Every directory under `root` (relative paths), so empty folders show in the
/// tree and persist when their last file is removed. Mirrors the file walk's
/// ignore rules; the root itself is excluded.
pub(crate) fn scan_folders(root: &Path) -> Result<Vec<String>, FileError> {
    let mut folders = Vec::new();
    let walker = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy();
            !is_ignored_segment(&name)
        });

    for entry in walker {
        let entry = match entry {
            Ok(value) => value,
            Err(_) => continue,
        };
        if entry.depth() == 0 || !entry.file_type().is_dir() {
            continue;
        }
        let relative_path = entry
            .path()
            .strip_prefix(root)
            .map_err(|error| FileError::Message {
                message: error.to_string(),
            })?
            .to_string_lossy()
            .replace('\\', "/");
        folders.push(relative_path);
    }

    folders.sort();
    Ok(folders)
}

pub(crate) fn ensure_vault_metadata(
    metadata: &MetadataStore,
    workspace_id: &str,
    root: &Path,
) -> Result<(), FileError> {
    metadata.ensure_vault(workspace_id, &workspace_name_for_root(root), root)?;
    Ok(())
}

/// The content-hash inventory plus the paths whose bytes couldn't be read.
///
/// A `skipped` path was seen on disk by the scan but failed `std::fs::read` —
/// the canonical case is an iCloud-dataless note that can't be materialized
/// on demand (offline, evicted, or removed from iCloud). It is reported, not
/// dropped, so the sync can keep the document's existing metadata row rather
/// than mistaking a temporarily un-downloadable file for a deletion.
pub(crate) struct WorkspaceInventory {
    pub entries: Vec<DocumentInventoryEntry>,
    pub skipped: Vec<String>,
}

pub(crate) fn document_inventory_for_entries(
    root: &Path,
    entries: &[WorkspaceFileEntry],
) -> WorkspaceInventory {
    let mut inventory = Vec::with_capacity(entries.len());
    let mut skipped = Vec::new();
    for entry in entries {
        // One unreadable file (dataless iCloud placeholder, permission glitch,
        // a path that vanished mid-scan) must not abort the whole build — skip
        // it and carry on, mirroring the rebuild's content loop.
        let Ok(bytes) = std::fs::read(root.join(&entry.relative_path)) else {
            skipped.push(entry.relative_path.clone());
            continue;
        };
        inventory.push(DocumentInventoryEntry {
            content_hash: db::content_hash_bytes(&bytes),
            last_seen_mtime: entry.last_modified_ms,
            last_seen_size: entry.size_bytes,
            relative_path: entry.relative_path.clone(),
            title: db::title_from_path(&entry.relative_path),
        });
    }
    WorkspaceInventory {
        entries: inventory,
        skipped,
    }
}

fn workspace_name_for_root(root: &Path) -> String {
    root.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| root.to_string_lossy().to_string())
}

/// Directory names hidden from the workspace scan (both the file tree and the
/// folder list): dotfiles/dotdirs (`.git`, `.obsidian`, `.trash`, …) plus common
/// tool/build/cache dirs a notes vault never wants to see. Kept conservative —
/// only names a user is very unlikely to give a real notes folder (so no
/// `build`/`out`/`vendor`, which double as ordinary words).
pub(crate) fn is_ignored_segment(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "node_modules" | "target" | "dist" | "__pycache__" | "venv" | "__MACOSX"
        )
}

pub(crate) fn mtime_ms(metadata: &std::fs::Metadata) -> Result<i64, FileError> {
    let modified = metadata.modified()?;
    let duration = modified
        .duration_since(UNIX_EPOCH)
        .map_err(|error| FileError::Message {
            message: format!("file timestamp is invalid: {error}"),
        })?;
    Ok(duration.as_millis() as i64)
}

pub(crate) fn write_file_atomic(target: &Path, content: impl AsRef<[u8]>) -> Result<(), FileError> {
    let parent = target.parent().ok_or_else(|| FileError::Message {
        message: "file path has no parent".to_owned(),
    })?;
    std::fs::create_dir_all(parent)?;
    let file_name = target
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let tmp = parent.join(format!(".{file_name}.tmp-{nanos}"));
    std::fs::write(&tmp, content.as_ref())?;
    if let Err(error) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(error.into());
    }
    Ok(())
}

/// Write whole-file `content` to a workspace file and record a history
/// snapshot of it. The single seam used by document writes that don't carry a
/// fine-grained change list — restore, and applying a reviewed file change.
pub(crate) fn write_and_record(
    registry: &WorkspaceRegistry,
    metadata: &MetadataStore,
    workspace_id: &str,
    relative_path: &str,
    content: &str,
) -> Result<WorkspaceWriteResult, FileError> {
    let result = write_file(registry, workspace_id, relative_path, content, None)?;
    metadata.record_document_written(
        workspace_id,
        relative_path,
        content,
        result.last_modified_ms,
        content.len() as u64,
    )?;
    Ok(result)
}

/// Soft-delete a workspace file: snapshot its content into history (when it's
/// text), move the physical file to the recoverable trash, and mark it deleted
/// in metadata. Never hard-deletes. Shared by the delete command and the
/// review "accept a deletion" path.
///
/// The trash-entry row is recorded *before* the physical move so the retention
/// sweep ([`trash_sweep`]) can never miss a trashed file — an orphan file with
/// no row would leak forever, defeating the growth bound. If the move then
/// fails, the row is rolled back.
pub(crate) fn soft_delete(
    registry: &WorkspaceRegistry,
    metadata: &MetadataStore,
    workspace_id: &str,
    relative_path: &str,
) -> Result<(), FileError> {
    // Snapshot first: this is the recovery path that outlives the physical
    // trash copy once the retention sweep purges it.
    if let Ok(existing) = read_file(registry, workspace_id, relative_path) {
        metadata.record_document_written(
            workspace_id,
            relative_path,
            &existing.content,
            existing.last_modified_ms,
            existing.content.len() as u64,
        )?;
    }

    let absolute = registry.resolve_workspace_path(workspace_id, relative_path)?;
    let size_bytes = std::fs::metadata(&absolute).map(|m| m.len()).unwrap_or(0) as i64;
    let trash_root = metadata.trash_root()?;
    let trashed_name = trash::trashed_name_for(&absolute);

    let entry_id = metadata.record_trash_entry(
        workspace_id,
        relative_path,
        &trashed_name,
        size_bytes,
        db::now_ms(),
    )?;
    if let Err(error) = trash::move_to_trash_as(&trash_root, workspace_id, &absolute, &trashed_name)
    {
        let _ = metadata.delete_trash_entry(&entry_id);
        return Err(error);
    }

    metadata.mark_document_deleted(workspace_id, relative_path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn registry_with_workspace(root: &Path) -> (WorkspaceRegistry, String) {
        let registry = WorkspaceRegistry::default();
        let list = registry
            .add(root.to_string_lossy().to_string())
            .expect("add");
        let workspace_id = list.workspaces[0].id.clone();
        (registry, workspace_id)
    }

    #[test]
    fn scan_returns_only_markdown_files_and_ignores_dot_dirs() {
        let dir = tempdir().expect("tempdir");
        fs::write(dir.path().join("README.md"), "hello").unwrap();
        fs::create_dir_all(dir.path().join("notes")).unwrap();
        fs::write(dir.path().join("notes/launch.md"), "hi").unwrap();
        fs::write(dir.path().join("plain.txt"), "x").unwrap();
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join(".git/HEAD"), "ref:").unwrap();
        fs::create_dir_all(dir.path().join("node_modules/pkg")).unwrap();
        fs::write(dir.path().join("node_modules/pkg/README.md"), "skip").unwrap();
        fs::create_dir_all(dir.path().join("target/debug")).unwrap();
        fs::write(dir.path().join("target/debug/build.md"), "skip").unwrap();

        let entries = scan_markdown_files(dir.path()).expect("scan");
        let paths: Vec<_> = entries.iter().map(|e| e.relative_path.clone()).collect();
        assert_eq!(paths, vec!["README.md", "notes/launch.md"]);
    }

    #[test]
    fn scan_of_an_unreadable_root_surfaces_an_error() {
        // A vault root we can't read (iCloud not materialized, gone) must surface
        // an error, not an empty list — so the caller retries instead of
        // rendering the vault as "no notes". A single unreadable file deeper in
        // the tree is still skipped; only a root-level failure aborts.
        let dir = tempdir().expect("tempdir");
        let missing = dir.path().join("not-mounted-yet");
        assert!(scan_markdown_files(&missing).is_err());
    }

    #[test]
    fn scan_folders_returns_every_dir_including_empty_and_ignores_tool_dirs() {
        let dir = tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join("Talks")).unwrap(); // empty — has no .md
        fs::create_dir_all(dir.path().join("Projects/sub")).unwrap();
        fs::write(dir.path().join("Projects/a.md"), "x").unwrap();
        fs::create_dir_all(dir.path().join(".git")).unwrap();
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        fs::create_dir_all(dir.path().join("node_modules")).unwrap();
        fs::create_dir_all(dir.path().join("__pycache__")).unwrap();
        fs::create_dir_all(dir.path().join("venv")).unwrap();

        let folders = scan_folders(dir.path()).expect("scan_folders");
        assert_eq!(folders, vec!["Projects", "Projects/sub", "Talks"]);
    }

    #[test]
    fn document_inventory_skips_an_unreadable_file_but_keeps_the_rest() {
        // A dataless iCloud placeholder (evicted / offline / removed from iCloud)
        // fails `std::fs::read`; it must be reported as skipped, not sink the whole
        // index build alongside its readable neighbours (#26).
        let dir = tempdir().expect("tempdir");
        fs::write(dir.path().join("present.md"), "# Present\n").expect("write present");

        let mut entries = scan_markdown_files(dir.path()).expect("scan one readable markdown file");
        // Splice in an entry whose backing file doesn't exist — the same read
        // error a placeholder yields when iCloud can't materialize it on demand.
        entries.push(WorkspaceFileEntry {
            last_modified_ms: 0,
            relative_path: "dataless.md".to_owned(),
            size_bytes: 345,
        });

        let inventory = document_inventory_for_entries(dir.path(), &entries);
        let indexed: Vec<&str> = inventory
            .entries
            .iter()
            .map(|entry| entry.relative_path.as_str())
            .collect();
        assert!(indexed.contains(&"present.md"), "readable file still indexed; got {indexed:?}");
        assert!(!indexed.contains(&"dataless.md"), "unreadable file skipped; got {indexed:?}");
        assert_eq!(inventory.skipped, vec!["dataless.md".to_owned()]);
    }

    #[test]
    fn create_folder_makes_an_empty_dir_then_errors_if_it_exists() {
        let dir = tempdir().expect("tempdir");
        let (registry, workspace_id) = registry_with_workspace(dir.path());

        create_folder(&registry, &workspace_id, "Talks").expect("create");
        assert!(dir.path().join("Talks").is_dir());
        assert_eq!(fs::read_dir(dir.path().join("Talks")).unwrap().count(), 0);
        assert!(scan_folders(dir.path()).unwrap().contains(&"Talks".to_string()));

        let again = create_folder(&registry, &workspace_id, "Talks");
        assert!(matches!(again, Err(FileError::AlreadyExists { .. })));
    }

    #[test]
    fn read_and_write_round_trip() {
        let dir = tempdir().expect("tempdir");
        let (registry, workspace_id) = registry_with_workspace(dir.path());
        fs::write(dir.path().join("note.md"), "hello").unwrap();

        let content = read_file(&registry, &workspace_id, "note.md").expect("read");
        assert_eq!(content.content, "hello");

        let written = write_file(
            &registry,
            &workspace_id,
            "note.md",
            "updated",
            Some(content.last_modified_ms),
        )
        .expect("write");
        assert!(written.last_modified_ms >= content.last_modified_ms);

        let reread = read_file(&registry, &workspace_id, "note.md").expect("re-read");
        assert_eq!(reread.content, "updated");
    }

    #[test]
    fn write_binary_round_trips_bytes_and_creates_parent_dir() {
        let dir = tempdir().expect("tempdir");
        let (registry, workspace_id) = registry_with_workspace(dir.path());
        // A non-UTF-8 payload (PNG magic + bytes that aren't valid UTF-8)
        // proves this path is genuinely binary, not a disguised text write.
        let bytes = [0x89u8, b'P', b'N', b'G', 0x0D, 0x0A, 0x00, 0xFF, 0x93, 0x96];

        let result = write_binary_file(&registry, &workspace_id, "images/pic.png", &bytes)
            .expect("write binary");
        assert!(result.last_modified_ms > 0);

        // Parent dir `images/` was created and the bytes survive a round trip.
        let written = fs::read(dir.path().join("images/pic.png")).expect("read back");
        assert_eq!(written, bytes);
    }

    #[test]
    fn write_rejects_conflict_when_disk_is_newer() {
        let dir = tempdir().expect("tempdir");
        let (registry, workspace_id) = registry_with_workspace(dir.path());
        fs::write(dir.path().join("note.md"), "initial").unwrap();
        let initial = read_file(&registry, &workspace_id, "note.md").expect("read");

        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(dir.path().join("note.md"), "changed by another tool").unwrap();

        let result = write_file(
            &registry,
            &workspace_id,
            "note.md",
            "my change",
            Some(initial.last_modified_ms),
        );
        match result {
            Err(FileError::Conflict {
                latest_last_modified_ms,
            }) => {
                assert!(latest_last_modified_ms > initial.last_modified_ms);
            }
            other => panic!("expected conflict, got {other:?}"),
        }
    }

    #[test]
    fn write_without_expected_mtime_overwrites() {
        let dir = tempdir().expect("tempdir");
        let (registry, workspace_id) = registry_with_workspace(dir.path());

        write_file(&registry, &workspace_id, "fresh.md", "first", None).expect("write");
        let result =
            write_file(&registry, &workspace_id, "fresh.md", "second", None).expect("overwrite");
        assert!(result.last_modified_ms > 0);
    }

    #[test]
    fn create_rejects_existing_file() {
        let dir = tempdir().expect("tempdir");
        let (registry, workspace_id) = registry_with_workspace(dir.path());
        fs::write(dir.path().join("a.md"), "x").unwrap();

        let result = create_file(&registry, &workspace_id, "a.md", "y");
        assert!(matches!(result, Err(FileError::AlreadyExists { .. })));
    }

    #[test]
    fn rename_rejects_existing_target() {
        let dir = tempdir().expect("tempdir");
        let (registry, workspace_id) = registry_with_workspace(dir.path());
        fs::write(dir.path().join("a.md"), "x").unwrap();
        fs::write(dir.path().join("b.md"), "y").unwrap();

        let result = rename_file(&registry, &workspace_id, "a.md", "b.md");
        assert!(matches!(result, Err(FileError::AlreadyExists { .. })));
    }

    #[test]
    fn rename_moves_into_subdir() {
        let dir = tempdir().expect("tempdir");
        let (registry, workspace_id) = registry_with_workspace(dir.path());
        fs::write(dir.path().join("a.md"), "x").unwrap();

        rename_file(&registry, &workspace_id, "a.md", "notes/a.md").expect("rename");
        assert!(dir.path().join("notes/a.md").exists());
        assert!(!dir.path().join("a.md").exists());
    }

    #[test]
    fn soft_delete_trashes_file_records_history_and_a_trash_entry() {
        let data = tempdir().expect("data");
        let dir = tempdir().expect("workspace");
        let (registry, workspace_id) = registry_with_workspace(dir.path());
        let metadata = MetadataStore::default();
        metadata.init_from_dir(data.path()).expect("init metadata");
        ensure_vault_metadata(&metadata, &workspace_id, dir.path()).expect("vault");
        fs::write(dir.path().join("gone.md"), "bye").unwrap();

        soft_delete(&registry, &metadata, &workspace_id, "gone.md").expect("soft delete");

        // The real file left the workspace...
        assert!(!dir.path().join("gone.md").exists());
        // ...is restorable from history...
        assert_eq!(
            metadata
                .list_document_versions(&workspace_id, "gone.md", None, 10)
                .expect("versions")
                .len(),
            1
        );
        // ...and has a trash entry stamped now (so it survives until the
        // retention window elapses), with the physical file in the trash.
        let entries = metadata.expired_trash_entries(i64::MAX).expect("entries");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].original_path, "gone.md");
        let trash_root = metadata.trash_root().expect("trash root");
        let trashed = trash::trashed_path(&trash_root, &workspace_id, &entries[0].trashed_name);
        assert_eq!(fs::read_to_string(&trashed).unwrap(), "bye");
    }

    #[test]
    fn delete_folder_moves_the_whole_subtree_to_trash() {
        let data = tempdir().expect("data");
        let dir = tempdir().expect("workspace");
        let (registry, workspace_id) = registry_with_workspace(dir.path());
        let metadata = MetadataStore::default();
        metadata.init_from_dir(data.path()).expect("init metadata");
        let trash_root = metadata.trash_root().expect("trash root");
        fs::create_dir_all(dir.path().join("Talks/sub")).unwrap();
        fs::write(dir.path().join("Talks/a.md"), "one").unwrap();
        fs::write(dir.path().join("Talks/sub/b.md"), "two").unwrap();

        delete_folder(&registry, &trash_root, &workspace_id, "Talks").expect("delete folder");

        // The whole subtree left the workspace...
        assert!(!dir.path().join("Talks").exists());
        // ...and landed in the vault's trash intact (nested file included).
        let vault_trash = trash_root.join(&workspace_id);
        let moved: Vec<_> = fs::read_dir(&vault_trash)
            .expect("read trash")
            .map(|entry| entry.unwrap().path())
            .collect();
        assert_eq!(moved.len(), 1);
        assert!(moved[0].is_dir());
        assert_eq!(fs::read_to_string(moved[0].join("a.md")).unwrap(), "one");
        assert_eq!(fs::read_to_string(moved[0].join("sub/b.md")).unwrap(), "two");
    }

    #[test]
    fn delete_folder_rejects_a_file_path() {
        let data = tempdir().expect("data");
        let dir = tempdir().expect("workspace");
        let (registry, workspace_id) = registry_with_workspace(dir.path());
        let metadata = MetadataStore::default();
        metadata.init_from_dir(data.path()).expect("init metadata");
        let trash_root = metadata.trash_root().expect("trash root");
        fs::write(dir.path().join("note.md"), "x").unwrap();

        let result = delete_folder(&registry, &trash_root, &workspace_id, "note.md");
        assert!(matches!(result, Err(FileError::NotFound { .. })));
        assert!(dir.path().join("note.md").exists()); // the file is untouched
    }

    #[test]
    fn commands_reject_path_traversal() {
        let data = tempdir().expect("data");
        let dir = tempdir().expect("tempdir");
        let (registry, workspace_id) = registry_with_workspace(dir.path());
        let metadata = MetadataStore::default();
        metadata.init_from_dir(data.path()).expect("init metadata");
        let trash_root = metadata.trash_root().expect("trash root");

        assert!(read_file(&registry, &workspace_id, "../escape.md").is_err());
        assert!(write_file(&registry, &workspace_id, "../escape.md", "x", None).is_err());
        assert!(write_binary_file(&registry, &workspace_id, "../escape.png", &[1, 2, 3]).is_err());
        assert!(create_file(&registry, &workspace_id, "../escape.md", "x").is_err());
        assert!(rename_file(&registry, &workspace_id, "a.md", "../escape.md").is_err());
        assert!(soft_delete(&registry, &metadata, &workspace_id, "../escape.md").is_err());
        assert!(delete_folder(&registry, &trash_root, &workspace_id, "../escape").is_err());
    }
}
