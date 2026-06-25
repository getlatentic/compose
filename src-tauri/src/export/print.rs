//! HTML → printer via macOS WebKit + AppKit.
//!
//! Renders the export HTML (from [`super::html`]) in an offscreen `WKWebView` —
//! same fidelity and pagination as the PDF export — then shows the system print
//! panel via the shared engine in [`super::paged`]. The panel lets the user pick
//! a printer (or "Save as PDF" from its PDF menu); Compose writes no file itself.
//! This is the "Print…" / ⌘P path — distinct from [`super::pdf`], which produces
//! PDF bytes for a save dialog. Both drive the same `NSPrintOperation` so their
//! page geometry (per-page margins, no empty trailing page) is identical.

use tauri::AppHandle;

#[cfg(not(target_os = "macos"))]
pub fn print_html(_app: &AppHandle, _html: &str) -> Result<bool, String> {
    Err("Printing is only supported on macOS in this build.".to_string())
}

#[cfg(target_os = "macos")]
pub fn print_html(app: &AppHandle, html: &str) -> Result<bool, String> {
    use super::paged::{run, Output, PrintInfoConfig};

    match run(app, html, PrintInfoConfig::ShowPanel)? {
        Output::Printed(printed) => Ok(printed),
        Output::Pdf(_) => Err("Print returned the wrong output kind".into()),
    }
}
