//! First-run "starter folder".
//!
//! Onboarding must never dead-end a non-technical user on "go find a folder."
//! This creates a default notes folder — `~/Documents/Compose` — they can
//! begin in with one click, seeds a friendly `Welcome.md` the first time so the
//! workspace is never an empty void, and returns the path for the front end to
//! open as a workspace. Reused (not re-seeded) on a later run, so clicking
//! "start with a starter folder" again just reopens the same folder.
//!
//! Plain `std::fs` — these writes are the user's own Documents folder, outside
//! any Tauri fs scope, so no capability is involved.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const STARTER_FOLDER_NAME: &str = "Compose";
const WELCOME_FILE: &str = "Welcome.md";

const WELCOME_CONTENT: &str = "# Welcome to Compose\n\n\
This is your notes folder. Every note you write lives right here on your \
computer as a plain Markdown file — nothing is uploaded.\n\n\
## A few things to try\n\n\
- **Just start writing.** Add a new note any time with the **+** button.\n\
- **Ask the assistant.** Open the chat on the right and ask it to draft, \
edit, or summarize — it works directly in your files.\n\
- **Highlight any text** to comment on it or send it to the assistant.\n\n\
You can delete this note whenever you like. Happy writing!\n";

/// Create (or reuse) the starter notes folder under `documents`, returning its
/// path. A `Welcome.md` is seeded only when the folder is freshly created, so a
/// returning user's notes are never disturbed.
pub fn create_starter_folder(documents: &Path) -> Result<PathBuf, String> {
    let dir = documents.join(STARTER_FOLDER_NAME);
    let fresh = !dir.exists();
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("could not create the starter folder: {error}"))?;
    if fresh {
        let welcome = dir.join(WELCOME_FILE);
        std::fs::write(&welcome, WELCOME_CONTENT)
            .map_err(|error| format!("could not write the welcome note: {error}"))?;
    }
    Ok(dir)
}

/// Resolve the user's Documents folder, create/reuse the starter folder, and
/// return its absolute path for the front end to open as a workspace.
#[tauri::command(async)]
pub fn workspace_create_starter(app: AppHandle) -> Result<String, String> {
    let documents = app
        .path()
        .document_dir()
        .map_err(|error| format!("could not find your Documents folder: {error}"))?;
    let dir = create_starter_folder(&documents)?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn creates_the_folder_and_seeds_welcome_on_first_run() {
        let docs = tempdir().expect("docs dir");
        let dir = create_starter_folder(docs.path()).expect("create starter");

        assert_eq!(dir, docs.path().join("Compose"));
        assert!(dir.is_dir());
        let welcome = dir.join("Welcome.md");
        assert!(welcome.is_file());
        assert!(std::fs::read_to_string(&welcome).unwrap().contains("Welcome to Compose"));
    }

    #[test]
    fn reuses_an_existing_folder_without_overwriting_the_welcome_note() {
        let docs = tempdir().expect("docs dir");
        // First run seeds the folder; the user then edits the welcome note.
        let dir = create_starter_folder(docs.path()).expect("first run");
        std::fs::write(dir.join("Welcome.md"), "my own edits").expect("edit welcome");

        // A second "start with a starter folder" must reopen, not re-seed.
        let again = create_starter_folder(docs.path()).expect("second run");
        assert_eq!(again, dir);
        assert_eq!(
            std::fs::read_to_string(dir.join("Welcome.md")).unwrap(),
            "my own edits",
        );
    }
}
