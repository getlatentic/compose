//! Quick capture: a global shortcut opens a small window over whatever the user
//! is doing, and what they type there becomes a new note in the active
//! workspace. The shortcut is held by Rust, so it works with every Compose
//! window closed.

mod shortcut;
mod text;
mod window;

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, Wry};
use tauri_plugin_global_shortcut::ShortcutState;

use crate::db::MetadataStore;
use crate::files::ensure_vault_metadata;
use crate::files::new_note::create_note;
use crate::workspace::{WorkspaceList, WorkspaceRecord, WorkspaceRegistry};

/// Tells the main window a note was captured.
pub const NOTE_CAPTURED_EVENT: &str = "compose:note-captured";
/// Long enough after launch that building the capture window never competes
/// with Compose's first screen.
const PREPARE_DELAY: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CapturedNote {
    pub workspace_id: String,
    pub relative_path: String,
}

/// The shortcut that opens capture, `None` once turned off, and the one it
/// starts as.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureShortcut {
    pub current: Option<String>,
    pub default: &'static str,
}

impl CaptureShortcut {
    fn new(current: Option<String>) -> Self {
        Self {
            current,
            default: shortcut::DEFAULT_SHORTCUT,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureDestination {
    pub workspace_id: String,
    pub name: String,
}

/// Delivers the shortcut: every press opens capture, or closes it if open.
pub fn plugin() -> tauri::plugin::TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                window::toggle(app);
            }
        })
        .build()
}

/// Register the chosen shortcut, then build the window once launch is done.
/// Runs after the metadata store is open, since that is where the choice lives.
pub fn start(app: &AppHandle) {
    let metadata = app.state::<MetadataStore>();
    let registered = shortcut::chosen(&metadata)
        .and_then(|chosen| shortcut::register(app, chosen.as_deref()));
    if let Err(error) = registered {
        eprintln!("quick capture shortcut: {error}");
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(PREPARE_DELAY);
        let window_owner = handle.clone();
        let _ = handle.run_on_main_thread(move || {
            if let Err(error) = window::prepare(&window_owner) {
                eprintln!("quick capture window: {error}");
            }
        });
    });
}

/// Save what was typed as a new note and close the window. `None` for blank
/// text, which leaves the window open.
#[tauri::command(async)]
pub fn capture_save(
    text: String,
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    metadata: State<'_, MetadataStore>,
) -> Result<Option<CapturedNote>, String> {
    if text.trim().is_empty() {
        return Ok(None);
    }
    let note = file_capture(&text, &registry, &metadata)?;
    let _ = app.emit(NOTE_CAPTURED_EVENT, &note);
    window::close(&app);
    Ok(Some(note))
}

/// Close without saving; the page keeps the draft for next time.
#[tauri::command]
pub fn capture_close(app: AppHandle) {
    window::close(&app);
}

/// Where a capture will be saved, for the window to say so.
#[tauri::command]
pub fn capture_destination(
    registry: State<'_, WorkspaceRegistry>,
) -> Result<Option<CaptureDestination>, String> {
    Ok(destination(&registry.list()?).map(|workspace| CaptureDestination {
        workspace_id: workspace.id.clone(),
        name: workspace.name.clone(),
    }))
}

#[tauri::command]
pub fn capture_shortcut(metadata: State<'_, MetadataStore>) -> Result<CaptureShortcut, String> {
    shortcut::chosen(&metadata).map(CaptureShortcut::new)
}

/// Change the shortcut, or turn it off with `None`. Saved only once the system
/// has accepted it; if it refuses, the previous shortcut keeps working.
#[tauri::command]
pub fn capture_set_shortcut(
    shortcut: Option<String>,
    app: AppHandle,
    metadata: State<'_, MetadataStore>,
) -> Result<CaptureShortcut, String> {
    let previous = shortcut::chosen(&metadata)?;
    if let Err(error) = shortcut::register(&app, shortcut.as_deref()) {
        let _ = shortcut::register(&app, previous.as_deref());
        return Err(error);
    }
    shortcut::save(&metadata, shortcut.as_deref())?;
    Ok(CaptureShortcut::new(shortcut))
}

fn file_capture(
    text: &str,
    registry: &WorkspaceRegistry,
    metadata: &MetadataStore,
) -> Result<CapturedNote, String> {
    let list = registry.list()?;
    let workspace = destination(&list)
        .ok_or("Open a workspace in Compose first: captured notes are saved there.")?;
    let root = registry.workspace_root(&workspace.id)?;
    ensure_vault_metadata(metadata, &workspace.id, &root).map_err(|error| error.to_string())?;
    let relative_path = create_note(
        registry,
        metadata,
        &workspace.id,
        &text::file_stem(text),
        &text::content(text),
    )
    .map_err(|error| error.to_string())?;
    Ok(CapturedNote {
        workspace_id: workspace.id.clone(),
        relative_path,
    })
}

/// The workspace open in Compose, else the first one there is.
fn destination(list: &WorkspaceList) -> Option<&WorkspaceRecord> {
    list.active_workspace_id
        .as_deref()
        .and_then(|active| list.workspaces.iter().find(|workspace| workspace.id == active))
        .or_else(|| list.workspaces.first())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        registry: WorkspaceRegistry,
        metadata: MetadataStore,
        _dirs: Vec<tempfile::TempDir>,
    }

    fn fixture(workspaces: usize) -> (Fixture, Vec<std::path::PathBuf>) {
        let [config, data] = [(); 2].map(|()| tempfile::tempdir().expect("dir"));
        let registry = WorkspaceRegistry::default();
        registry.init_from_dir(config.path()).expect("registry");
        let metadata = MetadataStore::default();
        metadata.init_from_dir(data.path()).expect("metadata");
        let mut dirs = vec![config, data];
        let mut vaults = Vec::new();
        for _ in 0..workspaces {
            let vault = tempfile::tempdir().expect("vault");
            registry.add(vault.path().to_string_lossy().into_owned()).expect("workspace");
            vaults.push(vault.path().canonicalize().expect("canonical"));
            dirs.push(vault);
        }
        (Fixture { registry, metadata, _dirs: dirs }, vaults)
    }

    #[test]
    fn a_capture_becomes_a_note_named_after_its_first_line() {
        let (fixture, vaults) = fixture(1);

        let note = file_capture("## Book idea\n\nA memoir told in recipes.\n\n", &fixture.registry, &fixture.metadata)
            .expect("capture");

        assert_eq!(note.relative_path, "Book idea.md");
        let written = std::fs::read_to_string(vaults[0].join("Book idea.md")).expect("note");
        assert_eq!(written, "## Book idea\n\nA memoir told in recipes.\n");
    }

    #[test]
    fn a_second_capture_with_the_same_title_does_not_replace_the_first() {
        let (fixture, vaults) = fixture(1);
        file_capture("Call Ade", &fixture.registry, &fixture.metadata).expect("first");
        let second = file_capture("Call Ade\nabout Friday", &fixture.registry, &fixture.metadata).expect("second");

        assert_eq!(second.relative_path, "Call Ade 2.md");
        assert_eq!(std::fs::read_to_string(vaults[0].join("Call Ade.md")).unwrap(), "Call Ade\n");
    }

    #[test]
    fn it_goes_to_the_workspace_open_in_compose() {
        let (fixture, _vaults) = fixture(2);
        let first = fixture.registry.list().unwrap().workspaces[0].id.clone();
        fixture.registry.switch(first.clone()).expect("switch");

        let note = file_capture("idea", &fixture.registry, &fixture.metadata).expect("capture");

        assert_eq!(note.workspace_id, first, "not simply the last one added");
    }

    #[test]
    fn with_no_workspace_there_is_nowhere_to_save() {
        let (fixture, _vaults) = fixture(0);
        let refused = file_capture("idea", &fixture.registry, &fixture.metadata);
        assert!(refused.is_err());
    }
}
