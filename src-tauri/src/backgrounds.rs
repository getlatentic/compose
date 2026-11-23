//! The image behind the note, chosen in Settings → Appearance.
//!
//! The chosen file is copied into Compose's own data folder, so the web view
//! is only ever allowed to read that folder (never the picture's original
//! location), and the background survives the original being moved or deleted.
//! One background is kept: choosing another replaces it.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::image_file;

const FOLDER: &str = "backgrounds";

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(FOLDER))
        .map_err(|error| format!("no data folder for backgrounds: {error}"))
}

fn allow(app: &AppHandle, dir: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(dir, false)
        .map_err(|error| format!("could not show the background: {error}"))
}

/// Copy `source` in as the background and return where it is now. The
/// previous background is removed once the new one is in place.
fn store(source: &Path, dir: &Path) -> Result<PathBuf, String> {
    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|_| image_file::is_readable_image(source))
        .ok_or_else(|| format!("Choose a PNG, JPEG, WebP or GIF image under {} MB.", image_file::MAX_BYTES / 1024 / 1024))?;
    std::fs::create_dir_all(dir).map_err(|error| format!("Could not keep the image: {error}"))?;
    let stored = dir.join(format!("{}.{extension}", uuid::Uuid::new_v4()));
    std::fs::copy(source, &stored).map_err(|error| format!("Could not keep the image: {error}"))?;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            if entry.path() != stored {
                if let Err(error) = std::fs::remove_file(entry.path()) {
                    eprintln!("backgrounds: could not remove {}: {error}", entry.path().display());
                }
            }
        }
    }
    Ok(stored)
}

/// Keep the image at `source` as the note background; returns its new path,
/// which the window is allowed to show.
#[tauri::command(async)]
pub fn background_image_store(source: String, app: AppHandle) -> Result<String, String> {
    let dir = folder(&app)?;
    let stored = store(Path::new(&source), &dir)?;
    allow(&app, &dir)?;
    Ok(stored.to_string_lossy().into_owned())
}

/// Let the window show the kept background, as it does after a launch.
#[tauri::command]
pub fn background_image_allow(app: AppHandle) -> Result<(), String> {
    allow(&app, &folder(&app)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_one_background_and_replaces_the_last() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path().join("backgrounds");
        let first = tmp.path().join("beach.JPG");
        let second = tmp.path().join("forest.png");
        std::fs::write(&first, image_file::fixtures::JPEG).expect("write");
        std::fs::write(&second, image_file::fixtures::PNG).expect("write");

        let kept = store(&first, &dir).expect("stores");
        assert_eq!(kept.extension().and_then(|ext| ext.to_str()), Some("jpg"));
        let replaced = store(&second, &dir).expect("stores");
        assert!(!kept.exists());
        assert_eq!(std::fs::read(&replaced).expect("read"), image_file::fixtures::PNG);
        assert_eq!(std::fs::read_dir(&dir).expect("dir").count(), 1);
    }

    #[test]
    fn refuses_what_is_not_an_image() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let doc = tmp.path().join("notes.pdf");
        std::fs::write(&doc, b"pdf").expect("write");
        let renamed = tmp.path().join("notes.png");
        std::fs::write(&renamed, b"%PDF-1.7").expect("write");
        assert!(store(&doc, &tmp.path().join("backgrounds")).is_err());
        assert!(store(&renamed, &tmp.path().join("backgrounds")).is_err());
        assert!(!tmp.path().join("backgrounds").exists());
    }
}
