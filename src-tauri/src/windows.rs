//! Multi-window orchestration.
//!
//! Tauri 2 supports multiple windows via [`WebviewWindowBuilder`]. Each window
//! gets its own webview, its own JS context, its own Zustand store — so state
//! isolation is automatic at the store level. A new window boots into the
//! no-workspace welcome and the user picks a folder; two windows = two
//! independent workspaces.
//!
//! The trickier piece is **event routing**: anything emitted with
//! `app.emit(...)` broadcasts to every window. Run events are routed
//! per-window via `BobRunnerInner.run_windows` (see `bob/runner.rs`); the
//! filesystem watcher's `WORKSPACE_FS_EVENT` is intentionally still a
//! broadcast (two windows showing the same workspace should both refresh —
//! the active-workspace filter on the store side discards events for the
//! wrong workspace).
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

/// Open a fresh Compose window. The new window boots into the
/// `NoWorkspaceWelcome` screen — its store starts empty, so there is no
/// workspace shared with the originating window.
///
/// The label is a unique `compose-<uuid>` so every window has a stable
/// identifier for per-window event routing.
#[tauri::command(async)]
pub fn open_new_window(app: AppHandle) -> Result<String, String> {
    let label = format!("compose-{}", Uuid::new_v4().simple());
    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("/".into()))
        .title("Compose")
        .inner_size(1440.0, 920.0)
        .min_inner_size(1120.0, 760.0)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    builder
        .build()
        .map_err(|e| format!("Could not open a new window: {e}"))?;
    // Ensure the new window comes forward — without this it sometimes opens
    // behind the focused one on macOS.
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.set_focus();
    }
    Ok(label)
}
