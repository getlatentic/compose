//! HTML → PDF via macOS WebKit + AppKit.
//!
//! Renders a self-contained HTML document (from [`super::html`]) in an offscreen
//! `WKWebView` and paginates it to a PDF via an `NSPrintOperation` configured to
//! save to a file (no panel) — the shared engine in [`super::paged`]. This gives
//! true multi-page output with identical per-page margins (from `NSPrintInfo`)
//! and no empty trailing page; WebKit's `createPDF` cannot do that (it emits one
//! tall page and ignores `@page`). The Print path ([`super::print`]) drives the
//! same engine, so the two agree page-for-page.
//!
//! ## Verification
//!
//! This path only runs inside the packaged macOS app (it needs a live AppKit main
//! thread). `cargo check`/`cargo test` validate the types and the `super::html`
//! renderer, but the actual PDF output must be confirmed by driving the `.app`
//! (see review-guide.md's "verify in the packaged app").

use tauri::AppHandle;

#[cfg(not(target_os = "macos"))]
pub fn html_to_pdf(_app: &AppHandle, _html: &str) -> Result<Vec<u8>, String> {
    Err("PDF export is only supported on macOS in this build.".to_string())
}

#[cfg(target_os = "macos")]
pub fn html_to_pdf(app: &AppHandle, html: &str) -> Result<Vec<u8>, String> {
    use super::paged::{run, Output, PrintInfoConfig};

    // Save into a temp DIRECTORY at a path that does not yet exist, then read the
    // bytes back: keeps `html_to_pdf`'s `Vec<u8>` contract so the caller still
    // writes the user's destination via the atomic-write path. A pre-created,
    // still-open temp *file* (the old approach) is a path `NSPrintSaveJob` won't
    // write to; a fresh path it creates itself works.
    let dir = tempfile::tempdir()
        .map_err(|error| format!("could not create a temp dir for the PDF: {error}"))?;
    let path = dir.path().join("compose-export.pdf");
    let config = PrintInfoConfig::SaveToPdf { path: path.clone() };
    match run(app, html, config) {
        Ok(Output::Pdf(bytes)) => Ok(bytes),
        Ok(Output::Printed(_)) => Err("PDF export returned the wrong output kind".into()),
        Err(error) => {
            eprintln!("export pdf: paged run failed: {error}");
            Err(error)
        }
    }
}
