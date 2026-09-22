//! The quick notes the window lists: kept as they are typed, deleted, and the
//! images pasted into them.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use super::images;
use crate::db::quick_notes::QuickNote;
use crate::db::MetadataStore;

/// Under the app's data folder: the images of quick notes not saved yet.
const IMAGES_FOLDER: &str = "quick-notes";

pub(super) fn images_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(IMAGES_FOLDER))
        .map_err(|error| format!("no data folder for quick notes: {error}"))
}

#[tauri::command(async)]
pub fn quick_notes(metadata: State<'_, MetadataStore>) -> Result<Vec<QuickNote>, String> {
    metadata.quick_notes()
}

/// Keep what is typed in quick note `id`, making the note if it is new.
#[tauri::command(async)]
pub fn quick_note_keep(id: String, body: String, metadata: State<'_, MetadataStore>) -> Result<QuickNote, String> {
    metadata.save_quick_note(&id, &body)
}

/// Delete a quick note without saving it, and the images pasted into it.
#[tauri::command(async)]
pub fn quick_note_delete(id: String, app: AppHandle, metadata: State<'_, MetadataStore>) -> Result<(), String> {
    metadata.delete_quick_note(&id)?;
    images::discard(&images::folder(&images_dir(&app)?, &id));
    Ok(())
}

/// Keep an image pasted into quick note `id` at `relative_path` (`images/…`).
#[tauri::command(async)]
pub fn quick_note_keep_image(id: String, relative_path: String, bytes: Vec<u8>, app: AppHandle) -> Result<(), String> {
    images::save(&images::folder(&images_dir(&app)?, &id), &relative_path, &bytes)
}

/// The folder quick note `id`'s images are in, which the window may now show.
#[tauri::command]
pub fn quick_note_folder(id: String, app: AppHandle) -> Result<String, String> {
    let dir = images_dir(&app)?;
    app.asset_protocol_scope()
        .allow_directory(&dir, true)
        .map_err(|error| format!("could not show quick-note images: {error}"))?;
    Ok(images::folder(&dir, &id).to_string_lossy().into_owned())
}
