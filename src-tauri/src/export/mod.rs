//! Document export.
//!
//! v1 ships **PDF** export (macOS): a document's markdown is rendered to a
//! self-contained HTML document ([`html`]) and macOS WebKit generates the PDF
//! ([`pdf`]). HTML/DOCX are deliberately deferred (see RELEASE.md §3).
//!
//! The whole concern lives here rather than reaching into the front-end
//! preview pipeline, so the renderer, the native PDF call, and the command are
//! one cohesive module. The source path is resolved through the workspace
//! registry's path-safety seam (`resolve_workspace_path`); the destination is a
//! user-chosen save location outside the vault.

mod html;
mod pdf;

use crate::workspace::WorkspaceRegistry;
use serde::Serialize;
use std::path::Path;
use tauri::{AppHandle, State};

/// A generated export artifact, returned to the front end.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportArtifact {
    pub format: ExportFormat,
    pub path: String,
}

/// Export formats. v1 = PDF only; HTML/DOCX land later (RELEASE.md §3).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Pdf,
}

/// Export a workspace document to a PDF at `destination_path`.
///
/// `content` is the document's current (possibly-unsaved) markdown, so the PDF
/// matches what the user sees in the editor. `relative_path` is resolved
/// against the registered workspace root (rejecting traversal) to locate the
/// document's directory — used both as the path-safety gate and to resolve
/// relative image paths. `destination_path` is the absolute save location the
/// user picked.
#[tauri::command(async)]
pub fn workspace_export_pdf(
    workspace_id: String,
    relative_path: String,
    content: String,
    destination_path: String,
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<ExportArtifact, String> {
    if destination_path.trim().is_empty() {
        return Err("No destination was chosen for the PDF.".to_string());
    }
    let source = registry.resolve_workspace_path(&workspace_id, &relative_path)?;
    let doc_dir = source.parent().unwrap_or_else(|| Path::new("."));
    let title = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("document");

    let document_html = html::render_markdown_to_html(&content, title, doc_dir);
    let pdf_bytes = pdf::html_to_pdf(&app, &document_html)?;

    crate::files::write_file_atomic(Path::new(&destination_path), &pdf_bytes)
        .map_err(|error| format!("Could not save the PDF: {error}"))?;

    Ok(ExportArtifact {
        format: ExportFormat::Pdf,
        path: destination_path,
    })
}
