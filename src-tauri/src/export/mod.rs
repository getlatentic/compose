//! Document export.
//!
//! A document's markdown is rendered to a self-contained HTML document
//! ([`html`]) — GFM, a print stylesheet, images inlined. **HTML** export writes
//! that directly (any platform); **PDF** export hands it to macOS WebKit
//! ([`pdf`]). DOCX is deferred (see RELEASE.md §3).
//!
//! The whole concern lives here rather than reaching into the front-end
//! preview pipeline, so the renderer, the native PDF call, and the command are
//! one cohesive module. A document is resolved either through the workspace
//! registry's path-safety seam (`resolve_workspace_path`) or, for a file opened
//! outside any workspace, through the external-files registry; the destination
//! is a user-chosen save location outside the vault.

mod fonts;
mod html;
mod mermaid;
mod paged;
mod pdf;
mod print;

use crate::document_kind::DocumentKind;
use crate::external::ExternalFilesRegistry;
use crate::workspace::WorkspaceRegistry;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
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

/// Which document to render: one inside a registered workspace, or a file the
/// user opened from outside every workspace.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum DocumentRef {
    Workspace {
        workspace_id: String,
        relative_path: String,
    },
    External {
        path: String,
    },
}

/// Export a document to a PDF at `destination_path`.
///
/// `content` is the document's current (possibly-unsaved) markdown, so the PDF
/// matches what the user sees in the editor. Resolving `document` locates its
/// directory, which relative image references resolve against.
/// `destination_path` is the absolute save location the user picked.
#[tauri::command(async)]
pub fn document_export_pdf(
    document: DocumentRef,
    content: String,
    destination_path: String,
    mermaid_svgs: HashMap<String, String>,
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    externals: State<'_, ExternalFilesRegistry>,
) -> Result<ExportArtifact, String> {
    let destination = check_destination(&destination_path, "PDF")?;
    let source = resolve_document(&document, &registry, &externals)?;
    let document_html = document_html(&source, &content, mermaid_svgs);
    let pdf_bytes = pdf::html_to_pdf(&app, &document_html)?;
    crate::files::write_file_atomic(destination, &pdf_bytes)
        .map_err(|error| format!("Could not save the PDF: {error}"))?;
    Ok(ExportArtifact {
        format: ExportFormat::Pdf,
        path: destination_path,
    })
}

/// Export a document to a standalone HTML file at `destination_path`. Same
/// renderer as PDF (self-contained: GFM + print CSS + inlined images), but
/// written directly — no WebKit, so it works on any platform.
#[tauri::command(async)]
pub fn document_export_html(
    document: DocumentRef,
    content: String,
    destination_path: String,
    mermaid_svgs: HashMap<String, String>,
    registry: State<'_, WorkspaceRegistry>,
    externals: State<'_, ExternalFilesRegistry>,
) -> Result<ExportArtifact, String> {
    let destination = check_destination(&destination_path, "HTML file")?;
    let source = resolve_document(&document, &registry, &externals)?;
    let document_html = document_html(&source, &content, mermaid_svgs);
    crate::files::write_file_atomic(destination, document_html.as_bytes())
        .map_err(|error| format!("Could not save the HTML file: {error}"))?;
    Ok(ExportArtifact {
        format: ExportFormat::Html,
        path: destination_path,
    })
}

/// Print a document via the system print panel (a printer, or "Save as PDF"
/// from the panel's PDF menu). Renders the same self-contained HTML as the PDF
/// export, then hands it to macOS's print system — Compose writes no file.
/// `content` is the document's current (possibly-unsaved) markdown, so what
/// prints matches the editor. Resolves to whether the user printed (vs cancelled
/// the panel).
#[tauri::command(async)]
pub fn document_print(
    document: DocumentRef,
    content: String,
    mermaid_svgs: HashMap<String, String>,
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    externals: State<'_, ExternalFilesRegistry>,
) -> Result<bool, String> {
    let source = resolve_document(&document, &registry, &externals)?;
    let document_html = document_html(&source, &content, mermaid_svgs);
    print::print_html(&app, &document_html)
}

fn check_destination<'a>(destination_path: &'a str, what: &str) -> Result<&'a Path, String> {
    if destination_path.trim().is_empty() {
        return Err(format!("No destination was chosen for the {what}."));
    }
    Ok(Path::new(destination_path))
}

/// Where the document is, and whether Compose may read it.
///
/// A workspace document is confined to its registered root, traversal rejected.
/// An external file has no root to be confined to, so what stands in for one is
/// the external-files registry: Compose renders a loose file only while it is
/// one the user has open.
fn resolve_document(
    document: &DocumentRef,
    registry: &WorkspaceRegistry,
    externals: &ExternalFilesRegistry,
) -> Result<PathBuf, String> {
    match document {
        DocumentRef::Workspace {
            workspace_id,
            relative_path,
        } => registry.resolve_workspace_path(workspace_id, relative_path),
        DocumentRef::External { path } => {
            // The registry records canonical paths, and the same file reached
            // through a symlink is the same file.
            let source = std::fs::canonicalize(path)
                .map_err(|error| format!("Could not open {path}: {error}"))?;
            if !externals.is_registered(&source.to_string_lossy())? {
                return Err("That file is not open in Compose.".to_owned());
            }
            Ok(source)
        }
    }
}

/// Render a document's current content to a self-contained HTML document: a
/// note as Markdown, whose relative images resolve against its own directory;
/// a plain-text file exactly as written.
fn document_html(
    source: &Path,
    content: &str,
    mermaid_svgs: HashMap<String, String>,
) -> String {
    let title = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("document");
    if DocumentKind::of(source) == Some(DocumentKind::PlainText) {
        return html::render_plain_text_to_html(content, title);
    }
    let doc_dir = source.parent().unwrap_or_else(|| Path::new("."));
    html::render_markdown_to_html_with_mermaid(content, title, doc_dir, mermaid_svgs)
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

    /// An external file the user has opened, and the registry that knows it.
    fn registry_with_external_file() -> (ExternalFilesRegistry, PathBuf, tempfile::TempDir) {
        let dir = tempdir().expect("tempdir");
        let file = dir.path().join("loose.md");
        std::fs::write(&file, "# loose").expect("write");
        let externals = ExternalFilesRegistry::default();
        externals.init_from_dir(dir.path()).expect("init");
        externals
            .add(&file.to_string_lossy())
            .expect("open the file");
        (externals, file, dir)
    }

    #[test]
    fn renders_a_document_from_its_current_content() {
        let html = document_html(
            Path::new("/vault/notes/x.md"),
            "# Hi\n\n**bold**",
            HashMap::new(),
        );
        assert!(html.contains("<h1"));
        assert!(html.contains("<strong>bold</strong>"));
        assert!(html.contains("<title>x</title>"));
        assert!(html.contains("<!doctype html>"));
    }

    #[test]
    fn a_text_file_renders_as_written() {
        let html = document_html(Path::new("/notes/todo.txt"), "# milk\n**eggs**", HashMap::new());
        assert!(html.contains("# milk\n**eggs**"), "{html}");
        assert!(!html.contains("<h1") && !html.contains("<strong>"), "{html}");
        assert!(html.contains("<title>todo</title>"));
    }

    #[test]
    fn a_workspace_document_resolves_inside_its_root() {
        let (registry, workspace_id, dir) = registry_with_workspace();
        let externals = ExternalFilesRegistry::default();
        let source = resolve_document(
            &DocumentRef::Workspace {
                workspace_id,
                relative_path: "notes/x.md".to_owned(),
            },
            &registry,
            &externals,
        )
        .expect("resolve");
        assert!(source.starts_with(dir.path().canonicalize().expect("canonical")));
    }

    #[test]
    fn a_workspace_document_cannot_climb_out_of_its_root() {
        let (registry, workspace_id, _dir) = registry_with_workspace();
        let externals = ExternalFilesRegistry::default();
        assert!(resolve_document(
            &DocumentRef::Workspace {
                workspace_id,
                relative_path: "../escape.md".to_owned(),
            },
            &registry,
            &externals,
        )
        .is_err());
    }

    #[test]
    fn a_file_the_user_opened_resolves_without_a_workspace() {
        let (externals, file, _dir) = registry_with_external_file();
        let registry = WorkspaceRegistry::default();
        let source = resolve_document(
            &DocumentRef::External {
                path: file.to_string_lossy().into_owned(),
            },
            &registry,
            &externals,
        )
        .expect("resolve");
        assert_eq!(source, file.canonicalize().expect("canonical"));
    }

    #[test]
    fn a_file_the_user_never_opened_is_refused() {
        let (externals, file, dir) = registry_with_external_file();
        let other = dir.path().join("not-open.md");
        std::fs::write(&other, "# other").expect("write");
        let registry = WorkspaceRegistry::default();

        let refused = resolve_document(
            &DocumentRef::External {
                path: other.to_string_lossy().into_owned(),
            },
            &registry,
            &externals,
        );

        assert!(refused.is_err(), "only files open in Compose render");
        assert!(file.exists(), "the one that is open is untouched");
    }

    #[test]
    fn a_document_ref_decodes_from_what_the_front_end_sends() {
        let workspace: DocumentRef = serde_json::from_str(
            r#"{"kind":"workspace","workspaceId":"w1","relativePath":"notes/x.md"}"#,
        )
        .expect("workspace ref");
        assert_eq!(
            workspace,
            DocumentRef::Workspace {
                workspace_id: "w1".to_owned(),
                relative_path: "notes/x.md".to_owned(),
            }
        );

        let external: DocumentRef =
            serde_json::from_str(r#"{"kind":"external","path":"/tmp/x.md"}"#).expect("external ref");
        assert_eq!(
            external,
            DocumentRef::External {
                path: "/tmp/x.md".to_owned(),
            }
        );
    }

    #[test]
    fn empty_destination_is_rejected() {
        assert!(check_destination("  ", "HTML file").is_err());
        assert!(check_destination("/tmp/out.html", "HTML file").is_ok());
    }
}
