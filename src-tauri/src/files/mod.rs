use crate::db::{self, DocumentInventoryEntry, MetadataStore};
use crate::workspace::WorkspaceRegistry;
use serde::Serialize;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use walkdir::WalkDir;

pub mod clone;
pub mod diff;
pub mod trash;
pub mod watcher;

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
    registry: State<'_, WorkspaceRegistry>,
    metadata: State<'_, MetadataStore>,
    watchers: State<'_, watcher::WatcherManager>,
) -> Result<Vec<WorkspaceFileEntry>, FileError> {
    let root = registry.workspace_root(&workspace_id)?;
    let entries = scan_markdown_files(&root)?;
    ensure_vault_metadata(&metadata, &workspace_id, &root)?;
    let inventory = document_inventory_for_entries(&root, &entries)?;
    metadata.sync_documents(&workspace_id, inventory)?;
    if let Err(message) = watchers.ensure_watcher(&workspace_id, &root) {
        eprintln!("watcher failed to start for {workspace_id}: {message}");
    }
    Ok(entries)
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
            content.as_bytes().len() as u64,
        )?;
    } else {
        let base = base.ok_or_else(|| FileError::Message {
            message: "cannot record document transaction without an existing base file".to_owned(),
        })?;
        metadata.record_document_transaction(
            &workspace_id,
            &relative_path,
            &base.content,
            &content,
            changes,
            result.last_modified_ms,
            content.as_bytes().len() as u64,
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
        content.as_bytes().len() as u64,
    )?;
    Ok(result)
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
        existing.content.as_bytes().len() as u64,
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
    // Preserve the file's content in version history before removing it, so it
    // stays restorable. Non-text files can't be read as a string; they skip the
    // snapshot but the physical trash copy below still recovers them.
    if let Ok(existing) = read_file(&registry, &workspace_id, &relative_path) {
        metadata.record_document_written(
            &workspace_id,
            &relative_path,
            &existing.content,
            existing.last_modified_ms,
            existing.content.as_bytes().len() as u64,
        )?;
    }
    // Move to recoverable trash instead of hard-deleting.
    let trash_root = metadata.trash_root()?;
    trash_file(&registry, &workspace_id, &relative_path, &trash_root)?;
    metadata.mark_document_deleted(&workspace_id, &relative_path)?;
    Ok(())
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
            current.content.as_bytes().len() as u64,
        )?;
    }
    let content = metadata.document_version_content(&workspace_id, &relative_path, &revision_id)?;
    // The user explicitly chose this version — overwrite unconditionally.
    let result = write_file(&registry, &workspace_id, &relative_path, &content, None)?;
    metadata.record_document_written(
        &workspace_id,
        &relative_path,
        &content,
        result.last_modified_ms,
        content.as_bytes().len() as u64,
    )?;
    Ok(result)
}

pub(crate) fn read_file(
    registry: &WorkspaceRegistry,
    workspace_id: &str,
    relative_path: &str,
) -> Result<WorkspaceFileContent, FileError> {
    let absolute = registry.resolve_workspace_path(workspace_id, relative_path)?;
    let content = std::fs::read_to_string(&absolute)?;
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

/// Move a workspace file into the recoverable trash, returning its trashed
/// path. Resolution rejects path traversal (via `resolve_workspace_path`) just
/// like every other file command.
pub(crate) fn trash_file(
    registry: &WorkspaceRegistry,
    workspace_id: &str,
    relative_path: &str,
    trash_root: &Path,
) -> Result<std::path::PathBuf, FileError> {
    let absolute = registry.resolve_workspace_path(workspace_id, relative_path)?;
    trash::move_to_trash(trash_root, workspace_id, &absolute)
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
            Err(_) => continue,
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

pub(crate) fn ensure_vault_metadata(
    metadata: &MetadataStore,
    workspace_id: &str,
    root: &Path,
) -> Result<(), FileError> {
    metadata.ensure_vault(workspace_id, &workspace_name_for_root(root), root)?;
    Ok(())
}

pub(crate) fn document_inventory_for_entries(
    root: &Path,
    entries: &[WorkspaceFileEntry],
) -> Result<Vec<DocumentInventoryEntry>, FileError> {
    entries
        .iter()
        .map(|entry| {
            let bytes = std::fs::read(root.join(&entry.relative_path))?;
            Ok(DocumentInventoryEntry {
                content_hash: db::content_hash_bytes(&bytes),
                last_seen_mtime: entry.last_modified_ms,
                last_seen_size: entry.size_bytes,
                relative_path: entry.relative_path.clone(),
                title: db::title_from_path(&entry.relative_path),
            })
        })
        .collect()
}

fn workspace_name_for_root(root: &Path) -> String {
    root.file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
        .unwrap_or_else(|| root.to_string_lossy().to_string())
}

pub(crate) fn is_ignored_segment(name: &str) -> bool {
    name.starts_with('.') || matches!(name, "node_modules" | "target" | "dist")
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

fn write_file_atomic(target: &Path, content: &str) -> Result<(), FileError> {
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
    std::fs::write(&tmp, content)?;
    if let Err(error) = std::fs::rename(&tmp, target) {
        let _ = std::fs::remove_file(&tmp);
        return Err(error.into());
    }
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
    fn trash_moves_file_out_of_workspace() {
        let dir = tempdir().expect("tempdir");
        let trash = tempdir().expect("trash");
        let (registry, workspace_id) = registry_with_workspace(dir.path());
        fs::write(dir.path().join("a.md"), "x").unwrap();

        let trashed =
            trash_file(&registry, &workspace_id, "a.md", trash.path()).expect("trash");
        assert!(!dir.path().join("a.md").exists());
        assert_eq!(fs::read_to_string(&trashed).unwrap(), "x");
    }

    #[test]
    fn commands_reject_path_traversal() {
        let dir = tempdir().expect("tempdir");
        let trash = tempdir().expect("trash");
        let (registry, workspace_id) = registry_with_workspace(dir.path());

        assert!(read_file(&registry, &workspace_id, "../escape.md").is_err());
        assert!(write_file(&registry, &workspace_id, "../escape.md", "x", None).is_err());
        assert!(create_file(&registry, &workspace_id, "../escape.md", "x").is_err());
        assert!(rename_file(&registry, &workspace_id, "a.md", "../escape.md").is_err());
        assert!(trash_file(&registry, &workspace_id, "../escape.md", trash.path()).is_err());
    }
}
