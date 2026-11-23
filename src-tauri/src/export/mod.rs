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

mod card;
mod fonts;
mod html;
mod mermaid;
mod paged;
mod pdf;
mod print;
mod share;
mod snapshot;
mod typeface;

use crate::document_kind::DocumentKind;
use typeface::ExportTypefaces;
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
    Image,
    Markdown,
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
    typefaces: Option<ExportTypefaces>,
    app: AppHandle,
) -> Result<ExportArtifact, String> {
    use tauri::Manager;
    let destination = check_destination(&destination_path, "PDF")?;
    let source = resolve_document(&document, &app.state::<WorkspaceRegistry>(), &app.state::<ExternalFilesRegistry>())?;
    let document_html = document_html(&source, &content, mermaid_svgs, &ExportTypefaces::or_default(typefaces));
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
    typefaces: Option<ExportTypefaces>,
    registry: State<'_, WorkspaceRegistry>,
    externals: State<'_, ExternalFilesRegistry>,
) -> Result<ExportArtifact, String> {
    let destination = check_destination(&destination_path, "HTML file")?;
    let source = resolve_document(&document, &registry, &externals)?;
    let document_html = document_html(&source, &content, mermaid_svgs, &ExportTypefaces::or_default(typefaces));
    crate::files::write_file_atomic(destination, document_html.as_bytes())
        .map_err(|error| format!("Could not save the HTML file: {error}"))?;
    Ok(ExportArtifact {
        format: ExportFormat::Html,
        path: destination_path,
    })
}

/// Save markdown the user chose a location for: a note's current text or a
/// conversation turned into markdown. Written as-is, atomically.
#[tauri::command(async)]
pub fn document_export_markdown(content: String, destination_path: String) -> Result<ExportArtifact, String> {
    write_markdown(&content, &destination_path)
}

fn write_markdown(content: &str, destination_path: &str) -> Result<ExportArtifact, String> {
    let destination = check_destination(destination_path, "Markdown file")?;
    crate::files::write_file_atomic(destination, content.as_bytes())
        .map_err(|error| format!("Could not save the Markdown file: {error}"))?;
    Ok(ExportArtifact {
        format: ExportFormat::Markdown,
        path: destination_path.to_string(),
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
    typefaces: Option<ExportTypefaces>,
    app: AppHandle,
    registry: State<'_, WorkspaceRegistry>,
    externals: State<'_, ExternalFilesRegistry>,
) -> Result<bool, String> {
    let source = resolve_document(&document, &registry, &externals)?;
    let document_html = document_html(&source, &content, mermaid_svgs, &ExportTypefaces::or_default(typefaces));
    print::print_html(&app, &document_html)
}

/// The card's HTML, for the export dialog's live preview: the same document
/// [`document_export_image`] draws.
#[tauri::command(async)]
pub fn card_preview_html(spec: card::CardSpec, app: AppHandle) -> String {
    card_document(&spec, &app)
}

/// The card's HTML with the note's own images inlined beside it, when the
/// card says which note it is and Compose may read it.
fn card_document(spec: &card::CardSpec, app: &AppHandle) -> String {
    use tauri::Manager;
    let html = card::card_html(spec, backgrounds_dir(app).as_deref());
    let source = spec.document.as_ref().and_then(|document| {
        resolve_document(document, &app.state::<WorkspaceRegistry>(), &app.state::<ExternalFilesRegistry>()).ok()
    });
    match source.as_deref().and_then(Path::parent) {
        Some(dir) => html::inline_local_images(&html, dir),
        None => html,
    }
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
    let html = card_document(&spec, &app);
    let bytes = snapshot::render(&app, &html, spec.size.pixels(), format)?;
    crate::files::write_file_atomic(destination, &bytes).map_err(|error| format!("Could not save the image: {error}"))?;
    Ok(ExportArtifact {
        format: ExportFormat::Image,
        path: destination_path,
    })
}

/// Draw a card as PNG and put it on the clipboard, to paste into a post.
#[tauri::command(async)]
pub fn card_copy_image(spec: card::CardSpec, app: AppHandle) -> Result<(), String> {
    let html = card_document(&spec, &app);
    let png = snapshot::render(&app, &html, spec.size.pixels(), snapshot::ImageFormat::Png)?;
    share::copy_png(&app, png)
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
    use tauri::Manager;
    let html = card_document(&spec, &app);
    let png = snapshot::render(&app, &html, spec.size.pixels(), snapshot::ImageFormat::Png)?;
    let dir = app.path().app_cache_dir().map_err(|error| format!("no cache folder: {error}"))?.join("shared-cards");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|error| format!("Could not prepare the image to share: {error}"))?;
    let file = dir.join(share::share_file_name(&file_name));
    crate::files::write_file_atomic(&file, &png).map_err(|error| format!("Could not prepare the image to share: {error}"))?;
    share::show_share_sheet(&window, file, anchor)
}

/// Where the note background is kept; a card may only embed an image from
/// there.
fn backgrounds_dir(app: &AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path().app_data_dir().ok().map(|dir| dir.join("backgrounds"))
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
    typefaces: &ExportTypefaces,
) -> String {
    let title = source
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("document");
    if DocumentKind::of(source) == Some(DocumentKind::PlainText) {
        return html::render_plain_text_to_html(content, title, typefaces);
    }
    let doc_dir = source.parent().unwrap_or_else(|| Path::new("."));
    html::render_markdown_to_html_with_mermaid(content, title, doc_dir, mermaid_svgs, typefaces)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn saves_markdown_exactly_as_given() {
        let dir = tempdir().expect("tempdir");
        let path = dir.path().join("note.md");
        let text = "# Title\n\n**bold** and `code`\n";
        let artifact = write_markdown(text, &path.to_string_lossy()).expect("export");
        assert_eq!(artifact.format, ExportFormat::Markdown);
        assert_eq!(std::fs::read_to_string(&path).expect("read"), text);
    }

    #[test]
    fn refuses_markdown_without_a_destination() {
        assert!(write_markdown("x", "  ").is_err());
    }

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
            &ExportTypefaces::default(),
        );
        assert!(html.contains("<h1"));
        assert!(html.contains("<strong>bold</strong>"));
        assert!(html.contains("<title>x</title>"));
        assert!(html.contains("<!doctype html>"));
    }

    #[test]
    fn a_text_file_renders_as_written() {
        let html = document_html(Path::new("/notes/todo.txt"), "# milk\n**eggs**", HashMap::new(), &ExportTypefaces::default());
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
