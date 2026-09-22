//! Clipboard history: what the user copies in any app, kept so it can be found
//! again from the quick-note window. Off until the user turns it on; passwords
//! and other private copies are never kept (see `copy`).

mod copy;
#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "macos")]
mod watch;

use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::db::clipboard_history::{ClipboardKind, ClipboardSummary};
use crate::db::MetadataStore;

const SETTING_KEY: &str = "clipboard.history";
/// Tells the quick-note window a copy was kept.
pub const CHANGED_EVENT: &str = "clipboard:changed";
/// Unpinned entries kept before the oldest go.
const KEEP: usize = 300;
/// Entries the window asks for at a time.
const LISTED: usize = 200;

/// Whether history is on, and the clipboard's change counter at the last look.
#[derive(Default)]
pub struct ClipboardHistory {
    enabled: AtomicBool,
    seen: AtomicIsize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardHistoryView {
    pub enabled: bool,
    pub items: Vec<ClipboardSummary>,
}

/// One entry with everything it holds, an image as a data URL.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardEntryView {
    pub id: String,
    pub kind: ClipboardKind,
    pub text: String,
    pub html: Option<String>,
    pub image_data_url: Option<String>,
}

/// Read whether history is on, and start watching the clipboard.
pub fn start(app: &AppHandle) {
    let enabled = app.state::<MetadataStore>().app_setting::<bool>(SETTING_KEY).ok().flatten().unwrap_or(false);
    app.state::<ClipboardHistory>().enabled.store(enabled, Ordering::SeqCst);
    #[cfg(target_os = "macos")]
    watch::start(app.clone());
}

#[tauri::command(async)]
pub fn clipboard_history(
    query: String,
    history: State<'_, ClipboardHistory>,
    metadata: State<'_, MetadataStore>,
) -> Result<ClipboardHistoryView, String> {
    Ok(ClipboardHistoryView {
        enabled: history.enabled.load(Ordering::SeqCst),
        items: metadata.clipboard_items(&query, LISTED)?,
    })
}

/// Turn history on or off. Turning it on keeps what is on the clipboard now.
#[tauri::command(async)]
pub fn clipboard_set_enabled(
    enabled: bool,
    history: State<'_, ClipboardHistory>,
    metadata: State<'_, MetadataStore>,
) -> Result<bool, String> {
    metadata.set_app_setting(SETTING_KEY, &enabled)?;
    if enabled {
        history.seen.store(-1, Ordering::SeqCst);
    }
    history.enabled.store(enabled, Ordering::SeqCst);
    Ok(enabled)
}

#[tauri::command(async)]
pub fn clipboard_entry(id: String, metadata: State<'_, MetadataStore>) -> Result<Option<ClipboardEntryView>, String> {
    Ok(metadata.clipboard_item(&id)?.map(|item| ClipboardEntryView {
        image_data_url: item
            .image_png
            .map(|png| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))),
        id: item.id,
        kind: item.kind,
        text: item.text,
        html: item.html,
    }))
}

/// Put an entry back on the clipboard, to paste in any app. Runs on the main
/// thread, where AppKit's pasteboard belongs.
#[tauri::command]
pub fn clipboard_copy(id: String, metadata: State<'_, MetadataStore>) -> Result<(), String> {
    let item = metadata.clipboard_item(&id)?.ok_or("That copy is no longer in the history.")?;
    #[cfg(target_os = "macos")]
    return if mac::write(&item) { Ok(()) } else { Err("The clipboard did not take it.".to_owned()) };
    #[cfg(not(target_os = "macos"))]
    {
        let _ = item;
        Err("Clipboard history needs macOS.".to_owned())
    }
}

#[tauri::command(async)]
pub fn clipboard_pin(id: String, pinned: bool, metadata: State<'_, MetadataStore>) -> Result<(), String> {
    metadata.set_clipboard_pinned(&id, pinned)
}

#[tauri::command(async)]
pub fn clipboard_forget(id: String, metadata: State<'_, MetadataStore>) -> Result<(), String> {
    metadata.forget_clipboard_item(&id)
}

/// Forget every copy but the pinned ones.
#[tauri::command(async)]
pub fn clipboard_clear(metadata: State<'_, MetadataStore>) -> Result<(), String> {
    metadata.clear_clipboard_history(false)
}
