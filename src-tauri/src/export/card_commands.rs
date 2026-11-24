//! The image-card commands: preview, save, copy and share. Each draws the
//! same card document, so what the dialog previews is what every one of them
//! produces.

use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

use super::{card, check_destination, html, resolve_for, share, snapshot, ExportArtifact, ExportFormat};

/// The card's HTML, for the export dialog's live preview: the same document
/// [`document_export_image`] draws.
#[tauri::command(async)]
pub fn card_preview_html(spec: card::CardSpec, app: AppHandle) -> String {
    card_document(&spec, &app)
}

/// Draw a note as an image (a cover, quote or page card at a post's size)
/// and save it at `destination_path` as JPEG or PNG.
#[tauri::command(async)]
pub fn document_export_image(
    spec: card::CardSpec,
    format: snapshot::ImageFormat,
    destination_path: String,
    app: AppHandle,
) -> Result<ExportArtifact, String> {
    let destination = check_destination(&destination_path, "image")?;
    let bytes = render_card(&spec, &app, format)?;
    crate::files::write_file_atomic(destination, &bytes).map_err(|error| format!("Could not save the image: {error}"))?;
    Ok(ExportArtifact { format: ExportFormat::Image, path: destination_path })
}

/// Draw a card as PNG and put it on the clipboard, to paste into a post.
#[tauri::command(async)]
pub fn card_copy_image(spec: card::CardSpec, app: AppHandle) -> Result<(), String> {
    share::copy_png(&app, render_card(&spec, &app, snapshot::ImageFormat::Png)?)
}

/// Draw a card as PNG and open the Mac's share sheet for it, against the
/// Share button. The file is kept in Compose's cache folder, replacing the
/// last one shared.
#[tauri::command(async)]
pub fn card_share(
    spec: card::CardSpec,
    file_name: String,
    anchor: share::ShareAnchor,
    window: tauri::WebviewWindow,
    app: AppHandle,
) -> Result<(), String> {
    let png = render_card(&spec, &app, snapshot::ImageFormat::Png)?;
    let file = keep_for_sharing(&app, &file_name, &png)?;
    share::show_share_sheet(&window, file, anchor)
}

fn render_card(spec: &card::CardSpec, app: &AppHandle, format: snapshot::ImageFormat) -> Result<Vec<u8>, String> {
    snapshot::render(app, &card_document(spec, app), spec.size.pixels(), format)
}

/// The card's HTML with the note's own images inlined beside it, when the
/// card says which note it is and Compose may read it.
fn card_document(spec: &card::CardSpec, app: &AppHandle) -> String {
    let html = card::card_html(spec, backgrounds_dir(app).as_deref());
    let source = spec.document.as_ref().and_then(|document| resolve_for(app, document).ok());
    match source.as_deref().and_then(Path::parent) {
        Some(dir) => html::inline_local_images(&html, dir),
        None => html,
    }
}

/// Write `png` into the cache folder for the share sheet, replacing the last
/// card shared.
fn keep_for_sharing(app: &AppHandle, file_name: &str, png: &[u8]) -> Result<PathBuf, String> {
    fn failed(error: impl std::fmt::Display) -> String {
        format!("Could not prepare the image to share: {error}")
    }
    let dir = app.path().app_cache_dir().map_err(|error| format!("no cache folder: {error}"))?.join("shared-cards");
    match std::fs::remove_dir_all(&dir) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(failed(error)),
        _ => {}
    }
    std::fs::create_dir_all(&dir).map_err(failed)?;
    let file = dir.join(share::share_file_name(file_name));
    crate::files::write_file_atomic(&file, png).map_err(failed)?;
    Ok(file)
}

/// Where the note background is kept; a card may only embed an image from
/// there.
fn backgrounds_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("backgrounds"))
}

