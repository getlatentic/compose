//! Document export.
//!
//! A document's markdown is rendered to a self-contained HTML document
//! ([`html`]) — GFM, a print stylesheet, images inlined. **HTML** export writes
//! that directly (any platform); **PDF** export hands it to macOS WebKit
//! ([`pdf`]). DOCX is deferred (see RELEASE.md §3).
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

/// Export formats. DOCX lands later (RELEASE.md §3).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Pdf,
    Html,
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
    let destination = check_destination(&destination_path, "PDF")?;
    let document_html = render_document_html(&registry, &workspace_id, &relative_path, &content)?;
    let pdf_bytes = pdf::html_to_pdf(&app, &document_html)?;
    crate::files::write_file_atomic(destination, &pdf_bytes)
        .map_err(|error| format!("Could not save the PDF: {error}"))?;
    Ok(ExportArtifact {
        format: ExportFormat::Pdf,
        path: destination_path,
    })
}

/// Export a workspace document to a standalone HTML file at `destination_path`.
/// Same renderer as PDF (self-contained: GFM + print CSS + inlined images), but
/// written directly — no WebKit, so it works on any platform.
#[tauri::command(async)]
pub fn workspace_export_html(
    workspace_id: String,
    relative_path: String,
    content: String,
    destination_path: String,
    registry: State<'_, WorkspaceRegistry>,
) -> Result<ExportArtifact, String> {
    let destination = check_destination(&destination_path, "HTML file")?;
    let document_html = render_document_html(&registry, &workspace_id, &relative_path, &content)?;
    crate::files::write_file_atomic(destination, document_html.as_bytes())
        .map_err(|error| format!("Could not save the HTML file: {error}"))?;
    Ok(ExportArtifact {
        format: ExportFormat::Html,
        path: destination_path,
    })
}

fn check_destination<'a>(destination_path: &'a str, what: &str) -> Result<&'a Path, String> {
    if destination_path.trim().is_empty() {
        return Err(format!("No destination was chosen for the {what}."));
    }
    Ok(Path::new(destination_path))
}

/// Resolve the document (path-safety gate + locate its directory for relative
/// images) and render its current markdown to a self-contained HTML document.
fn render_document_html(
    registry: &WorkspaceRegistry,
    workspace_id: &str,
    relative_path: &str,
    content: &str,
) -> Result<String, String> {
    let source = registry.resolve_workspace_path(workspace_id, relative_path)?;
    let doc_dir = source.parent().unwrap_or_else(|| Path::new("."));
    let title = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("document");
    Ok(html::render_markdown_to_html(content, title, doc_dir))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn registry_with_workspace() -> (WorkspaceRegistry, String, tempfile::TempDir) {
        let dir = tempdir().expect("tempdir");
        let registry = WorkspaceRegistry::default();
        let list = registry
            .add(dir.path().to_string_lossy().to_string())
            .expect("add workspace");
        let workspace_id = list.workspaces[0].id.clone();
        (registry, workspace_id, dir)
    }

    #[test]
    fn renders_document_html_from_current_content() {
        let (registry, workspace_id, _dir) = registry_with_workspace();
        let html =
            render_document_html(&registry, &workspace_id, "notes/x.md", "# Hi\n\n**bold**")
                .expect("render");
        assert!(html.contains("<h1"));
        assert!(html.contains("<strong>bold</strong>"));
        assert!(html.contains("<title>x</title>"));
        assert!(html.contains("<!doctype html>"));
    }

    #[test]
    fn render_rejects_path_traversal() {
        let (registry, workspace_id, _dir) = registry_with_workspace();
        assert!(render_document_html(&registry, &workspace_id, "../escape.md", "x").is_err());
    }

    #[test]
    fn empty_destination_is_rejected() {
        assert!(check_destination("  ", "HTML file").is_err());
        assert!(check_destination("/tmp/out.html", "HTML file").is_ok());
    }
}
