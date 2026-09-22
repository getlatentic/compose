//! Quick notes: a global shortcut opens a small window over whatever the user
//! is doing. Notes jotted there wait, several at once, until one is saved as a
//! note in the active workspace; a second shortcut opens the clipboard history
//! in the same window. The shortcuts are held by Rust, so they work with every
//! Compose window closed.

mod images;
pub mod notes;
#[cfg(target_os = "macos")]
mod panel;
mod shortcut;
mod text;
mod window;

pub use shortcut::{RegisteredShortcuts, View};

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

/// A shortcut that opens the window, `None` once turned off, and the one it
/// starts as.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureShortcut {
    pub current: Option<String>,
    pub default: &'static str,
}

/// The shortcut on the notes and the one on the clipboard history.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureShortcuts {
    pub notes: CaptureShortcut,
    pub clipboard: CaptureShortcut,
}

impl CaptureShortcuts {
    fn from_chosen(chosen: Vec<(View, Option<String>)>) -> Self {
        let pick = |wanted: View| CaptureShortcut {
            current: chosen.iter().find(|(view, _)| *view == wanted).and_then(|(_, current)| current.clone()),
            default: wanted.default_shortcut(),
        };
        Self { notes: pick(View::Notes), clipboard: pick(View::Clipboard) }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureDestination {
    pub workspace_id: String,
    pub name: String,
}

/// Delivers the shortcuts: a press opens the window on that shortcut's part, or
/// closes it if the user is already there.
pub fn plugin() -> tauri::plugin::TauriPlugin<Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, pressed, event| {
            if event.state == ShortcutState::Pressed {
                let view = app.state::<RegisteredShortcuts>().view_for(pressed).unwrap_or(View::Notes);
                window::toggle(app, view);
            }
        })
        .build()
}

/// Register the chosen shortcuts, then build the window once launch is done.
/// Runs after the metadata store is open, since that is where the choices live.
pub fn start(app: &AppHandle) {
    let metadata = app.state::<MetadataStore>();
    let registered = shortcut::all_chosen(&metadata).and_then(|chosen| shortcut::register(app, &chosen));
    if let Err(error) = registered {
        eprintln!("quick note shortcuts: {error}");
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

/// Open the window on the notes from elsewhere than the shortcut — the widget's
/// New Note — leaving it open if it already is.
pub fn open(app: &AppHandle) {
    window::show(app, View::Notes);
}

/// Save quick note `id` as a note in the workspace, with the images pasted into
/// it, and close the window. `None` for blank text, which leaves the window open.
#[tauri::command(async)]
pub fn capture_save(
    id: String,
    text: String,
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    metadata: State<'_, MetadataStore>,
) -> Result<Option<CapturedNote>, String> {
    if text.trim().is_empty() {
        return Ok(None);
    }
    let images = images::folder(&notes::images_dir(&app)?, &id);
    let note = file_capture(&text, &images, &registry, &metadata)?;
    metadata.delete_quick_note(&id)?;
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
pub fn capture_shortcuts(metadata: State<'_, MetadataStore>) -> Result<CaptureShortcuts, String> {
    shortcut::all_chosen(&metadata).map(CaptureShortcuts::from_chosen)
}

/// Change the shortcut on `view`, or turn it off with `None`. Saved only once
/// the system has accepted it; if it refuses, the previous shortcuts keep working.
#[tauri::command]
pub fn capture_set_shortcut(
    view: View,
    shortcut: Option<String>,
    app: AppHandle,
    metadata: State<'_, MetadataStore>,
) -> Result<CaptureShortcuts, String> {
    let previous = shortcut::all_chosen(&metadata)?;
    let wanted: Vec<(View, Option<String>)> = previous
        .iter()
        .map(|(each, current)| (*each, if *each == view { shortcut.clone() } else { current.clone() }))
        .collect();
    if let Err(error) = shortcut::register(&app, &wanted) {
        let _ = shortcut::register(&app, &previous);
        return Err(error);
    }
    shortcut::save(&metadata, view, shortcut.as_deref())?;
    Ok(CaptureShortcuts::from_chosen(wanted))
}

fn file_capture(
    text: &str,
    images: &std::path::Path,
    registry: &WorkspaceRegistry,
    metadata: &MetadataStore,
) -> Result<CapturedNote, String> {
    let list = registry.list()?;
    let workspace = destination(&list)
        .ok_or("Open a workspace in Compose first: captured notes are saved there.")?;
    let root = registry.workspace_root(&workspace.id)?;
    ensure_vault_metadata(metadata, &workspace.id, &root).map_err(|error| error.to_string())?;
    // A captured note is saved at the workspace's top, so its images go there too.
    let text = images::move_into(images, &root, text)?;
    let relative_path = create_note(
        registry,
        metadata,
        &workspace.id,
        "",
        &text::file_stem(&text),
        &text::content(&text),
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

        let note = file_capture("## Book idea\n\nA memoir told in recipes.\n\n", &no_images(), &fixture.registry, &fixture.metadata)
            .expect("capture");

        assert_eq!(note.relative_path, "Book idea.md");
        let written = std::fs::read_to_string(vaults[0].join("Book idea.md")).expect("note");
        assert_eq!(written, "## Book idea\n\nA memoir told in recipes.\n");
    }

    #[test]
    fn a_second_capture_with_the_same_title_does_not_replace_the_first() {
        let (fixture, vaults) = fixture(1);
        file_capture("Call Ade", &no_images(), &fixture.registry, &fixture.metadata).expect("first");
        let second = file_capture("Call Ade\nabout Friday", &no_images(), &fixture.registry, &fixture.metadata).expect("second");

        assert_eq!(second.relative_path, "Call Ade 2.md");
        assert_eq!(std::fs::read_to_string(vaults[0].join("Call Ade.md")).unwrap(), "Call Ade\n");
    }

    #[test]
    fn it_goes_to_the_workspace_open_in_compose() {
        let (fixture, _vaults) = fixture(2);
        let first = fixture.registry.list().unwrap().workspaces[0].id.clone();
        fixture.registry.switch(first.clone()).expect("switch");

        let note = file_capture("idea", &no_images(), &fixture.registry, &fixture.metadata).expect("capture");

        assert_eq!(note.workspace_id, first, "not simply the last one added");
    }

    #[test]
    fn with_no_workspace_there_is_nowhere_to_save() {
        let (fixture, _vaults) = fixture(0);
        let refused = file_capture("idea", &no_images(), &fixture.registry, &fixture.metadata);
        assert!(refused.is_err());
    }

    #[test]
    fn a_pasted_image_moves_into_the_workspace_with_its_note() {
        let (fixture, vaults) = fixture(1);
        let waiting = tempfile::tempdir().expect("images");
        images::save(waiting.path(), "images/pasted.png", b"png").expect("paste");

        let note = file_capture("Sketch\n\n![pasted](images/pasted.png)", waiting.path(), &fixture.registry, &fixture.metadata)
            .expect("capture");

        assert_eq!(std::fs::read(vaults[0].join("images/pasted.png")).expect("image"), b"png");
        let written = std::fs::read_to_string(vaults[0].join(&note.relative_path)).expect("note");
        assert!(written.contains("![pasted](images/pasted.png)"));
    }

    /// A quick note nothing was pasted into.
    fn no_images() -> std::path::PathBuf {
        std::env::temp_dir().join("compose-quick-note-with-no-images")
    }
}
