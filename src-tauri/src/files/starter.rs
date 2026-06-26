//! First-run notes workspace.
//!
//! Onboarding must never dead-end a non-technical user on "go find a folder."
//! This creates the default notes workspace — `~/Compose/notes/My Notes` — and
//! returns its path for the front end to open. The layout leaves room to grow:
//! `~/Compose` is Compose's home (other app data later), `~/Compose/notes` is the
//! container for note workspaces, and `My Notes` is the one created on first run.
//! It starts EMPTY — the editor's welcome view seeds the first note on demand.
//!
//! The home folder — unlike Desktop/Downloads/Documents — is not macOS
//! privacy-protected, so creating it triggers no consent prompt. Plain `std::fs`:
//! the user's own home folder, outside any Tauri fs scope, so no capability is
//! involved.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const COMPOSE_DIR: &str = "Compose";
const NOTES_DIR: &str = "notes";
/// The first-run workspace folder name. User-facing — it's what the sidebar
/// shows — so a friendly "My Notes", not a system-y "default".
const DEFAULT_WORKSPACE: &str = "My Notes";

/// Create (or reuse) the default notes workspace `<base>/Compose/notes/My Notes`,
/// returning its path. Left empty — the front end seeds the welcome note on the
/// first "New note", so a returning user's folder is never touched.
pub fn create_starter_folder(base: &Path) -> Result<PathBuf, String> {
    let dir = base.join(COMPOSE_DIR).join(NOTES_DIR).join(DEFAULT_WORKSPACE);
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("could not create the notes folder: {error}"))?;
    Ok(dir)
}

/// Resolve the user's home folder, create/reuse `~/Compose/notes/My Notes`, and
/// return its absolute path for the front end to open as a workspace.
#[tauri::command(async)]
pub fn workspace_create_starter(app: AppHandle) -> Result<String, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|error| format!("could not find your home folder: {error}"))?;
    let dir = create_starter_folder(&home)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn creates_the_default_workspace_under_compose_notes() {
        let home = tempdir().expect("home dir");
        let dir = create_starter_folder(home.path()).expect("create starter");
        assert_eq!(
            dir,
            home.path().join("Compose").join("notes").join("My Notes")
        );
        assert!(dir.is_dir());
    }

    #[test]
    fn is_idempotent_and_leaves_existing_notes_untouched() {
        let home = tempdir().expect("home dir");
        let first = create_starter_folder(home.path()).expect("first run");
        std::fs::write(first.join("mine.md"), "hi").expect("write note");

        let again = create_starter_folder(home.path()).expect("second run");
        assert_eq!(again, first);
        assert_eq!(std::fs::read_to_string(first.join("mine.md")).unwrap(), "hi");
    }
}
