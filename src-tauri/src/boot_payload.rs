//! The first screen's data, read before the web view exists.
//!
//! Everything the launch screen shows is already on disk: the workspace list in
//! `workspaces.json`, the file tree in the vault's `documents` table, and the
//! open document in the vault folder. The web view spends its first few hundred
//! milliseconds fetching and compiling JavaScript, during which the native side
//! has nothing left to do, so that is when this reads them. The result is
//! injected as a global before the document is parsed, and the front end seeds
//! its stores from it — so the first render is the finished app instead of an
//! empty shell that fills in a pane at a time.
//!
//! Nothing here is load-bearing. Every field is optional, the whole read runs
//! under a deadline, and a miss just leaves the existing IPC path to do what it
//! already does.

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;

use crate::db::MetadataStore;
use crate::external::ExternalFilesRegistry;
use crate::files::{WorkspaceFileContent, WorkspaceFileEntry};
use crate::workspace::WorkspaceRegistry;

/// How long the web view is willing to wait for its own data. The reads below
/// are a JSON parse and an indexed sqlite query — single-digit milliseconds on
/// a warm profile — but the open document lives in the user's vault, which may
/// be an iCloud folder that stalls on a cold read. Past this, launch continues
/// with whatever is ready and the front end fetches the rest as it always has.
const READ_DEADLINE: Duration = Duration::from_millis(250);

/// Documents past this size are left to the normal read: the point is to paint
/// sooner, and a multi-megabyte string costs more to serialize into the page
/// than the round-trip it saves.
const MAX_INLINE_DOCUMENT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootPayload {
    workspaces: Option<crate::workspace::WorkspaceList>,
    external_files: Option<crate::external::ExternalFilesList>,
    files: Vec<WorkspaceFileEntry>,
    folders: Vec<String>,
    active_file: Option<ActiveFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveFile {
    workspace_id: String,
    relative_path: String,
    content: String,
    last_modified_ms: i64,
}

/// The plugin that carries the payload into the page. `js_init_script` runs
/// after the global object exists but before the document is parsed, which is
/// the only point early enough for the front end to *seed* state with it rather
/// than fetch it.
pub fn plugin<R: tauri::Runtime>(script: String) -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("compose-boot")
        .js_init_script(script)
        .build()
}

/// Read the payload and wrap it as the assignment the page will run. An empty
/// string when there is nothing useful to say, which registers a plugin that
/// injects nothing.
pub fn init_script(profile_dir: Option<PathBuf>) -> String {
    let Some(profile_dir) = profile_dir else {
        return String::new();
    };
    let payload = read_within_deadline(profile_dir);
    if payload.workspaces.is_none() {
        return String::new();
    }
    match serde_json::to_string(&payload) {
        Ok(json) => format!("window.__COMPOSE_BOOT__ = JSON.parse({});", js_string(&json)),
        Err(_) => String::new(),
    }
}

/// A JavaScript string literal holding `value`. JSON's own string escaping is a
/// subset of JavaScript's, except for the two line separators that are legal
/// inside a JSON string and (before ES2019) were not legal inside a JS one.
fn js_string(value: &str) -> String {
    serde_json::to_string(value)
        .unwrap_or_else(|_| "\"\"".to_owned())
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

/// Run the reads on their own thread and take whatever is done in time. The
/// thread is left to finish into a dropped channel rather than being waited on,
/// so a stalled vault delays nothing.
fn read_within_deadline(profile_dir: PathBuf) -> BootPayload {
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = sender.send(read(&profile_dir));
    });
    receiver.recv_timeout(READ_DEADLINE).unwrap_or_default()
}

pub(crate) fn read(profile_dir: &Path) -> BootPayload {
    let registry = WorkspaceRegistry::default();
    if registry.init_from_dir(profile_dir).is_err() {
        return BootPayload::default();
    }
    let Ok(list) = registry.list() else {
        return BootPayload::default();
    };

    let external_registry = ExternalFilesRegistry::default();
    let external_files = external_registry
        .init_from_dir(profile_dir)
        .ok()
        .and_then(|_| external_registry.list().ok());

    let active_id = list.active_workspace_id.clone();
    let (files, folders) = active_id
        .as_deref()
        .map(|id| inventory(profile_dir, id))
        .unwrap_or_default();
    let active_file = active_id
        .as_deref()
        .and_then(|id| open_document(&registry, &list, id));

    BootPayload {
        workspaces: Some(list),
        external_files,
        files,
        folders,
        active_file,
    }
}

/// The active vault's tree as the last scan recorded it — its files, and the
/// folders those files can't reveal. A folder holding no markdown file is
/// invisible to the document inventory, and those are precisely the rows that
/// used to appear a beat after the rest of the tree.
fn inventory(profile_dir: &Path, workspace_id: &str) -> (Vec<WorkspaceFileEntry>, Vec<String>) {
    let metadata = MetadataStore::default();
    if metadata.init_from_dir(profile_dir).is_err() {
        return (Vec::new(), Vec::new());
    }
    let files = metadata
        .document_inventory(workspace_id)
        .map(crate::files::inventory_entries)
        .unwrap_or_default();
    let folders = metadata.folder_inventory(workspace_id).unwrap_or_default();
    (files, folders)
}

/// The document the last session left open, read through the same path the
/// editor would use — so the iCloud handling and the mtime the save-conflict
/// check compares against are the real ones, not a second implementation.
fn open_document(
    registry: &WorkspaceRegistry,
    list: &crate::workspace::WorkspaceList,
    workspace_id: &str,
) -> Option<ActiveFile> {
    let record = list
        .workspaces
        .iter()
        .find(|workspace| workspace.id == workspace_id)?;
    let relative_path = record.tabs.as_ref()?.active_file_path.clone();
    if relative_path.is_empty() {
        return None;
    }
    let absolute = registry
        .resolve_workspace_path(workspace_id, &relative_path)
        .ok()?;
    if std::fs::metadata(&absolute).ok()?.len() > MAX_INLINE_DOCUMENT_BYTES {
        return None;
    }
    let WorkspaceFileContent {
        content,
        last_modified_ms,
    } = crate::files::read_file(registry, workspace_id, &relative_path).ok()?;
    Some(ActiveFile {
        workspace_id: workspace_id.to_owned(),
        relative_path,
        content,
        last_modified_ms,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::DocumentInventoryEntry;
    use crate::workspace::WorkspaceTabs;
    use tempfile::{tempdir, TempDir};

    struct Profile {
        dir: PathBuf,
        _profile: TempDir,
        _vault: TempDir,
    }

    /// A profile as a real launch finds it: a registered workspace with a note
    /// open, an inventory from the scan that ran last time, and the note itself
    /// on disk where the editor left it.
    fn launched_once(document: &str) -> Profile {
        let profile = tempdir().expect("profile dir");
        let vault = tempdir().expect("vault dir");
        std::fs::write(vault.path().join("note.md"), document).expect("write note");

        let registry = WorkspaceRegistry::default();
        registry.init_from_dir(profile.path()).expect("init registry");
        let list = registry
            .add(vault.path().to_string_lossy().into_owned())
            .expect("add workspace");
        let workspace_id = list.active_workspace_id.clone().expect("an active workspace");
        registry
            .update_tabs(
                &workspace_id,
                WorkspaceTabs {
                    active_file_path: "note.md".to_owned(),
                    open_file_paths: vec!["note.md".to_owned()],
                },
            )
            .expect("save tabs");

        let metadata = MetadataStore::default();
        metadata.init_from_dir(profile.path()).expect("init metadata");
        metadata
            .ensure_vault(&workspace_id, "Notes", vault.path())
            .expect("ensure vault");
        metadata
            .sync_documents(
                &workspace_id,
                vec![DocumentInventoryEntry {
                    content_hash: "hash".to_owned(),
                    last_seen_mtime: 10,
                    last_seen_size: document.len() as u64,
                    relative_path: "note.md".to_owned(),
                    title: None,
                }],
            )
            .expect("sync docs");
        metadata
            .replace_folders(&workspace_id, &["images".to_owned()])
            .expect("record folders");

        Profile {
            dir: profile.path().to_owned(),
            _profile: profile,
            _vault: vault,
        }
    }

    /// The positive arm. A payload that carried nothing would satisfy every
    /// "nothing wrong is injected" check while leaving the launch exactly as
    /// slow as before, so the test that matters is that all three pieces the
    /// first screen draws are actually in it.
    #[test]
    fn the_payload_carries_the_whole_first_screen() {
        let profile = launched_once("# Note\n\nBody");

        let payload = read(&profile.dir);

        let workspaces = payload.workspaces.expect("the workspace list");
        assert_eq!(workspaces.workspaces.len(), 1, "the registered workspace");
        assert_eq!(
            payload.files.iter().map(|entry| entry.relative_path.as_str()).collect::<Vec<_>>(),
            vec!["note.md"],
            "the tree, from the inventory the last scan wrote"
        );
        assert_eq!(
            payload.folders,
            vec!["images".to_owned()],
            "a folder with no markdown file in it can only come from here"
        );
        let active = payload.active_file.expect("the open document");
        assert_eq!(active.relative_path, "note.md");
        assert_eq!(active.content, "# Note\n\nBody", "the text, not just the path");
    }

    #[test]
    fn a_workspace_with_nothing_open_carries_no_document() {
        let profile = launched_once("# Note");
        let registry = WorkspaceRegistry::default();
        registry.init_from_dir(&profile.dir).expect("init registry");
        let id = registry.list().expect("list").active_workspace_id.expect("active");
        registry
            .update_tabs(&id, WorkspaceTabs::default())
            .expect("clear tabs");

        assert!(
            read(&profile.dir).active_file.is_none(),
            "no open tab means there is no document to inline"
        );
    }

    #[test]
    fn an_oversized_document_is_left_to_the_normal_read() {
        let profile = launched_once(&"x".repeat(MAX_INLINE_DOCUMENT_BYTES as usize + 1));

        let payload = read(&profile.dir);

        assert!(payload.active_file.is_none(), "past the cap, the round-trip is cheaper");
        assert_eq!(payload.files.len(), 1, "the tree is still worth carrying");
    }

    /// The document is arbitrary user text going into a JavaScript source
    /// string. Quotes, backslashes, newlines and the two line separators that
    /// JSON allows raw all have to come back out unchanged.
    #[test]
    fn a_document_that_would_break_a_js_literal_round_trips() {
        let hostile = "quote \" backslash \\ newline \n </script> sep \u{2028}\u{2029} done";
        let profile = launched_once(hostile);

        let script = init_script(Some(profile.dir.clone()));

        let literal = script
            .strip_prefix("window.__COMPOSE_BOOT__ = JSON.parse(")
            .and_then(|rest| rest.strip_suffix(");"))
            .expect("the assignment shape the page expects");
        assert!(
            !literal.contains('\u{2028}') && !literal.contains('\u{2029}'),
            "line separators must be escaped, not passed through"
        );
        let json: String = serde_json::from_str(literal).expect("a valid JS/JSON string literal");
        let decoded: serde_json::Value = serde_json::from_str(&json).expect("valid payload json");
        assert_eq!(
            decoded["activeFile"]["content"], hostile,
            "the document survives both layers of quoting"
        );
    }

    /// A first launch has no workspaces yet, and that is an answer worth
    /// injecting: it lets the front end open the setup screen on its first
    /// render instead of showing a splash while it asks.
    #[test]
    fn a_profile_with_no_workspaces_still_answers() {
        let profile = tempdir().expect("profile dir");

        let script = init_script(Some(profile.path().to_owned()));

        assert!(script.starts_with("window.__COMPOSE_BOOT__ ="), "got: {script}");
        assert!(script.contains("workspaces"), "an empty list is still a list");
    }

    #[test]
    fn no_profile_directory_injects_nothing() {
        assert_eq!(init_script(None), "");
    }
}
