//! Files opened individually from outside any workspace (Finder Open-With,
//! `open -a Compose file.md`). They are edited at their real absolute path —
//! nothing is mounted or copied — and tracked in a persisted list so the
//! sidebar's "External files" section survives restarts (#113).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

use crate::db::now_ms;
use crate::files::{read_at, write_at, FileError, WorkspaceFileContent, WorkspaceWriteResult};
use crate::workspace::WorkspaceRegistry;

/// Mirrors the `fileAssociations` extensions in tauri.conf.json.
const MARKDOWN_EXTENSIONS: [&str; 4] = ["md", "markdown", "mdown", "mkd"];

const PERSIST_VERSION: u32 = 1;
const REGISTRY_FILE_NAME: &str = "external_files.json";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFileRecord {
    pub path: String,
    #[serde(default)]
    pub added_at_ms: i64,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFilesList {
    pub files: Vec<ExternalFileRecord>,
    pub open_paths: Vec<String>,
    pub active_path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAddResult {
    /// The canonical spelling the file was registered under.
    pub path: String,
    pub list: ExternalFilesList,
}

/// Where an OS-opened path should land: inside a registered workspace it is
/// selected in place (never mounting a new workspace); anywhere else it joins
/// the external-files list.
// `rename_all` covers only the VARIANT names; the fields inside a struct
// variant need `rename_all_fields` to reach the TS client as camelCase.
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum OpenTarget {
    Workspace {
        workspace_id: String,
        relative_path: String,
    },
    External {
        path: String,
    },
}

#[derive(Default)]
pub struct ExternalFilesRegistry {
    state: Mutex<ExternalFilesRegistryState>,
}

#[derive(Debug, Default)]
struct ExternalFilesRegistryState {
    persist_path: Option<PathBuf>,
    files: Vec<ExternalFileRecord>,
    open_paths: Vec<String>,
    active_path: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedExternalFiles {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    files: Vec<ExternalFileRecord>,
    #[serde(default)]
    open_paths: Vec<String>,
    #[serde(default)]
    active_path: String,
}

impl ExternalFilesRegistry {
    pub fn init_from_app(&self, app: &AppHandle) -> Result<(), String> {
        let config_dir = app
            .path()
            .app_config_dir()
            .map_err(|error| format!("app config dir unavailable: {error}"))?;
        self.init_from_dir(&config_dir)
    }

    pub fn init_from_dir(&self, config_dir: &Path) -> Result<(), String> {
        std::fs::create_dir_all(config_dir)
            .map_err(|error| format!("could not create config dir: {error}"))?;
        let persist_path = config_dir.join(REGISTRY_FILE_NAME);
        let loaded = load_persisted(&persist_path)?;

        let mut state = self.lock_state()?;
        state.persist_path = Some(persist_path);
        // Entries whose file is currently missing are KEPT: an unmounted
        // volume or evicted iCloud file must not silently empty the list.
        // Opening one surfaces the read error next to its remove control.
        state.files = loaded.files;
        state.open_paths = loaded.open_paths;
        state.active_path = loaded.active_path;
        Ok(())
    }

    pub fn list(&self) -> Result<ExternalFilesList, String> {
        Ok(self.lock_state()?.to_list())
    }

    /// Register a file, returning the CANONICAL path it was stored under —
    /// the caller keys buffers/tabs on that spelling, not the OS event's.
    pub fn add(&self, raw_path: &str) -> Result<ExternalAddResult, String> {
        let path = markdown_file_path(raw_path)?;
        let canonical = std::fs::canonicalize(&path)
            .map_err(|error| format!("could not open {}: {error}", path.display()))?;
        // Canonicalization follows symlinks, so the policy checks must hold on
        // the TARGET: a `note.md` symlink must not smuggle an arbitrary file
        // into the registry (and into external_write_file's reach).
        if !canonical.is_file() {
            return Err(format!("{} is not a file", canonical.display()));
        }
        if !is_markdown_path(&canonical) {
            return Err("only Markdown files can be opened individually".to_owned());
        }
        let canonical = canonical.to_string_lossy().into_owned();

        let mut state = self.lock_state()?;
        if !state.files.iter().any(|record| record.path == canonical) {
            state.files.push(ExternalFileRecord {
                path: canonical.clone(),
                added_at_ms: now_ms(),
            });
        }
        let list = state.to_list();
        persist_state(&state)?;
        Ok(ExternalAddResult {
            path: canonical,
            list,
        })
    }

    pub fn remove(&self, path: &str) -> Result<ExternalFilesList, String> {
        let mut state = self.lock_state()?;
        state.files.retain(|record| record.path != path);
        state.open_paths.retain(|open| open != path);
        if state.active_path == path {
            state.active_path = String::new();
        }
        let list = state.to_list();
        persist_state(&state)?;
        Ok(list)
    }

    pub fn update_tabs(&self, open_paths: Vec<String>, active_path: String) -> Result<(), String> {
        let mut state = self.lock_state()?;
        state.open_paths = open_paths;
        state.active_path = active_path;
        persist_state(&state)
    }

    pub fn is_registered(&self, path: &str) -> Result<bool, String> {
        Ok(self
            .lock_state()?
            .files
            .iter()
            .any(|record| record.path == path))
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, ExternalFilesRegistryState>, String> {
        self.state
            .lock()
            .map_err(|_| "external files registry lock was poisoned".to_owned())
    }
}

impl ExternalFilesRegistryState {
    fn to_list(&self) -> ExternalFilesList {
        ExternalFilesList {
            files: self.files.clone(),
            open_paths: self.open_paths.clone(),
            active_path: self.active_path.clone(),
        }
    }
}

fn load_persisted(persist_path: &Path) -> Result<PersistedExternalFiles, String> {
    match std::fs::read_to_string(persist_path) {
        Ok(contents) if contents.trim().is_empty() => Ok(PersistedExternalFiles::default()),
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|error| format!("external_files.json is malformed: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(PersistedExternalFiles::default())
        }
        Err(error) => Err(format!("could not read external_files.json: {error}")),
    }
}

fn persist_state(state: &ExternalFilesRegistryState) -> Result<(), String> {
    let Some(persist_path) = state.persist_path.as_ref() else {
        return Ok(());
    };
    let payload = PersistedExternalFiles {
        version: PERSIST_VERSION,
        files: state.files.clone(),
        open_paths: state.open_paths.clone(),
        active_path: state.active_path.clone(),
    };
    let serialized = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("could not serialize external files: {error}"))?;
    if let Some(parent) = persist_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not create config dir: {error}"))?;
    }
    std::fs::write(persist_path, serialized)
        .map_err(|error| format!("could not write external_files.json: {error}"))?;
    Ok(())
}

pub(crate) fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .is_some_and(|ext| MARKDOWN_EXTENSIONS.contains(&ext.as_str()))
}

fn markdown_file_path(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("file path cannot be blank".to_owned());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("external file path must be absolute".to_owned());
    }
    if !is_markdown_path(&path) {
        return Err("only Markdown files can be opened individually".to_owned());
    }
    Ok(path)
}

/// The routing policy for OS-opened paths, pure over the given
/// `(workspace_id, root)` pairs. Nested workspaces resolve to the deepest
/// root containing the file; both sides are canonicalized so symlinked paths
/// (`/tmp` → `/private/tmp`) and Finder-vs-registry casing agree.
pub(crate) fn resolve_target(workspaces: &[(String, PathBuf)], raw: &Path) -> OpenTarget {
    let canonical = std::fs::canonicalize(raw).unwrap_or_else(|_| raw.to_path_buf());
    let mut best: Option<(usize, String, PathBuf)> = None;
    for (id, root) in workspaces {
        let Ok(root) = std::fs::canonicalize(root) else {
            continue;
        };
        let Ok(relative) = canonical.strip_prefix(&root) else {
            continue;
        };
        if relative.as_os_str().is_empty() {
            continue;
        }
        let depth = root.components().count();
        if best.as_ref().map_or(true, |(existing, _, _)| depth > *existing) {
            best = Some((depth, id.clone(), relative.to_path_buf()));
        }
    }
    match best {
        Some((_, workspace_id, relative)) => OpenTarget::Workspace {
            workspace_id,
            relative_path: relative.to_string_lossy().into_owned(),
        },
        None => OpenTarget::External {
            path: canonical.to_string_lossy().into_owned(),
        },
    }
}

fn require_registered(registry: &ExternalFilesRegistry, path: &str) -> Result<(), FileError> {
    if registry.is_registered(path).map_err(FileError::from)? {
        return Ok(());
    }
    Err(FileError::Message {
        message: "file is not in the external files list".to_owned(),
    })
}

#[tauri::command(async)]
pub fn external_list(
    registry: State<'_, ExternalFilesRegistry>,
) -> Result<ExternalFilesList, String> {
    registry.list()
}

#[tauri::command(async)]
pub fn external_add(
    path: String,
    registry: State<'_, ExternalFilesRegistry>,
) -> Result<ExternalAddResult, String> {
    registry.add(&path)
}

#[tauri::command(async)]
pub fn external_remove(
    path: String,
    registry: State<'_, ExternalFilesRegistry>,
) -> Result<ExternalFilesList, String> {
    registry.remove(&path)
}

#[tauri::command(async)]
pub fn external_save_tabs(
    open_paths: Vec<String>,
    active_path: String,
    registry: State<'_, ExternalFilesRegistry>,
) -> Result<(), String> {
    registry.update_tabs(open_paths, active_path)
}

#[tauri::command(async)]
pub fn external_read_file(
    path: String,
    registry: State<'_, ExternalFilesRegistry>,
) -> Result<WorkspaceFileContent, FileError> {
    require_registered(&registry, &path)?;
    read_at(Path::new(&path))
}

#[tauri::command(async)]
pub fn external_write_file(
    path: String,
    content: String,
    expected_last_modified_ms: Option<i64>,
    registry: State<'_, ExternalFilesRegistry>,
) -> Result<WorkspaceWriteResult, FileError> {
    require_registered(&registry, &path)?;
    write_at(Path::new(&path), &content, expected_last_modified_ms)
}

#[tauri::command(async)]
pub fn resolve_open_path(
    path: String,
    workspaces: State<'_, WorkspaceRegistry>,
) -> Result<OpenTarget, String> {
    let roots = workspaces
        .list()?
        .workspaces
        .into_iter()
        .map(|record| (record.id, PathBuf::from(record.path)))
        .collect::<Vec<_>>();
    Ok(resolve_target(&roots, Path::new(&path)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry_in(dir: &Path) -> ExternalFilesRegistry {
        let registry = ExternalFilesRegistry::default();
        registry.init_from_dir(dir).expect("init registry");
        registry
    }

    fn write_note(dir: &Path, name: &str, content: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, content).expect("write note");
        path
    }

    #[test]
    fn add_requires_absolute_markdown_path() {
        let dir = tempfile::tempdir().expect("tempdir");
        let registry = registry_in(dir.path());

        assert!(registry.add("notes.md").is_err());
        assert!(registry
            .add(dir.path().join("photo.png").to_str().unwrap())
            .is_err());
        assert!(registry
            .add(dir.path().join("missing.md").to_str().unwrap())
            .is_err());
    }

    #[test]
    fn add_canonicalizes_and_deduplicates() {
        let dir = tempfile::tempdir().expect("tempdir");
        let registry = registry_in(dir.path());
        let note = write_note(dir.path(), "note.md", "# hi");
        let canonical = std::fs::canonicalize(&note).unwrap();

        let added = registry.add(note.to_str().unwrap()).expect("add");
        assert_eq!(added.path, canonical.to_string_lossy());
        assert_eq!(added.list.files.len(), 1);
        assert_eq!(added.list.files[0].path, canonical.to_string_lossy());

        // A second add of the same file (even via a different spelling of the
        // path) must not duplicate the entry — and still reports the canonical
        // path so the caller keys on the stored spelling.
        let indirect = dir.path().join(".").join("note.md");
        let readded = registry.add(indirect.to_str().unwrap()).expect("re-add");
        assert_eq!(readded.path, canonical.to_string_lossy());
        assert_eq!(readded.list.files.len(), 1);
    }

    #[test]
    fn add_rejects_markdown_symlink_to_non_markdown_target() {
        let dir = tempfile::tempdir().expect("tempdir");
        let registry = registry_in(dir.path());
        let secret = dir.path().join("secrets.txt");
        std::fs::write(&secret, "top secret").expect("write");
        let link = dir.path().join("note.md");
        std::os::unix::fs::symlink(&secret, &link).expect("symlink");

        assert!(registry.add(link.to_str().unwrap()).is_err());
    }

    #[test]
    fn remove_strips_open_tabs_and_active() {
        let dir = tempfile::tempdir().expect("tempdir");
        let registry = registry_in(dir.path());
        let note = write_note(dir.path(), "note.md", "# hi");
        let path = registry.add(note.to_str().unwrap()).expect("add").path;
        registry
            .update_tabs(vec![path.clone()], path.clone())
            .expect("tabs");

        let list = registry.remove(&path).expect("remove");
        assert!(list.files.is_empty());
        assert!(list.open_paths.is_empty());
        assert_eq!(list.active_path, "");
    }

    #[test]
    fn persists_and_reloads_including_missing_files() {
        let dir = tempfile::tempdir().expect("tempdir");
        let note = write_note(dir.path(), "note.md", "# hi");
        let path = {
            let registry = registry_in(dir.path());
            let path = registry.add(note.to_str().unwrap()).expect("add").path;
            registry
                .update_tabs(vec![path.clone()], path.clone())
                .expect("tabs");
            path
        };

        // The file vanishing (unmounted volume, evicted iCloud copy) must not
        // silently empty the persisted list on the next boot.
        std::fs::remove_file(&note).expect("delete note");
        let reloaded = registry_in(dir.path());
        let list = reloaded.list().expect("list");
        assert_eq!(list.files.len(), 1);
        assert_eq!(list.files[0].path, path);
        assert_eq!(list.open_paths, vec![path.clone()]);
        assert_eq!(list.active_path, path);
    }

    #[test]
    fn io_requires_registration() {
        let dir = tempfile::tempdir().expect("tempdir");
        let registry = registry_in(dir.path());
        let note = write_note(dir.path(), "note.md", "# hi");
        let path = note.to_string_lossy().into_owned();

        assert!(require_registered(&registry, &path).is_err());
        let added = registry.add(&path).expect("add");
        assert!(require_registered(&registry, &added.path).is_ok());
    }

    #[test]
    fn write_detects_stale_expectation() {
        let dir = tempfile::tempdir().expect("tempdir");
        let note = write_note(dir.path(), "note.md", "# v1");

        let loaded = read_at(&note).expect("read");
        assert_eq!(loaded.content, "# v1");

        // Simulate an outside edit landing after our read.
        let future = std::time::SystemTime::now() + std::time::Duration::from_secs(5);
        let file = std::fs::File::options()
            .write(true)
            .open(&note)
            .expect("open");
        file.set_modified(future).expect("bump mtime");
        drop(file);

        let result = write_at(&note, "# v2", Some(loaded.last_modified_ms));
        assert!(matches!(result, Err(FileError::Conflict { .. })));

        // A forced write (no expectation) goes through and reports fresh mtime.
        let written = write_at(&note, "# v2", None).expect("forced write");
        assert!(written.last_modified_ms > 0);
        assert_eq!(std::fs::read_to_string(&note).unwrap(), "# v2");
    }

    #[test]
    fn resolve_prefers_deepest_workspace_and_falls_back_to_external() {
        let dir = tempfile::tempdir().expect("tempdir");
        let outer = dir.path().join("outer");
        let inner = outer.join("inner");
        std::fs::create_dir_all(&inner).expect("mkdirs");
        let in_inner = write_note(&inner, "deep.md", "# deep");
        let in_outer = write_note(&outer, "shallow.md", "# shallow");
        let outside = write_note(dir.path(), "loose.md", "# loose");

        let workspaces = vec![
            ("outer-id".to_owned(), outer.clone()),
            ("inner-id".to_owned(), inner.clone()),
        ];

        assert_eq!(
            resolve_target(&workspaces, &in_inner),
            OpenTarget::Workspace {
                workspace_id: "inner-id".to_owned(),
                relative_path: "deep.md".to_owned(),
            }
        );
        assert_eq!(
            resolve_target(&workspaces, &in_outer),
            OpenTarget::Workspace {
                workspace_id: "outer-id".to_owned(),
                relative_path: "shallow.md".to_owned(),
            }
        );
        let canonical_outside = std::fs::canonicalize(&outside).unwrap();
        assert_eq!(
            resolve_target(&workspaces, &outside),
            OpenTarget::External {
                path: canonical_outside.to_string_lossy().into_owned(),
            }
        );
        // A workspace root that no longer exists is skipped, not fatal.
        let workspaces = vec![("gone".to_owned(), dir.path().join("gone"))];
        assert!(matches!(
            resolve_target(&workspaces, &in_inner),
            OpenTarget::External { .. }
        ));
    }

    #[test]
    fn resolve_sees_through_symlinked_paths() {
        let dir = tempfile::tempdir().expect("tempdir");
        let real_root = dir.path().join("real");
        std::fs::create_dir_all(&real_root).expect("mkdir");
        let note = write_note(&real_root, "note.md", "# hi");
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&real_root, &link).expect("symlink");

        // Workspace registered via the symlink, file opened via the real path
        // (and vice versa) must still resolve into the workspace.
        let workspaces = vec![("ws".to_owned(), link.clone())];
        assert_eq!(
            resolve_target(&workspaces, &note),
            OpenTarget::Workspace {
                workspace_id: "ws".to_owned(),
                relative_path: "note.md".to_owned(),
            }
        );
        let via_link = link.join("note.md");
        let workspaces = vec![("ws".to_owned(), real_root.clone())];
        assert_eq!(
            resolve_target(&workspaces, &via_link),
            OpenTarget::Workspace {
                workspace_id: "ws".to_owned(),
                relative_path: "note.md".to_owned(),
            }
        );
    }
}

#[cfg(test)]
mod wire_tests {
    use super::*;

    #[test]
    fn open_target_serializes_camel_case_for_the_ts_client() {
        let target = OpenTarget::Workspace {
            workspace_id: "ws".to_owned(),
            relative_path: "a.md".to_owned(),
        };
        assert_eq!(
            serde_json::to_string(&target).unwrap(),
            r#"{"kind":"workspace","workspaceId":"ws","relativePath":"a.md"}"#
        );
        let target = OpenTarget::External {
            path: "/x/y.md".to_owned(),
        };
        assert_eq!(
            serde_json::to_string(&target).unwrap(),
            r#"{"kind":"external","path":"/x/y.md"}"#
        );
    }
}
