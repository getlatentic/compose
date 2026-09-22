//! Clipboard history: what the user copies in any app, kept so it can be found
//! again from the quick-note window. Off until the user turns it on; passwords
//! and other private copies are never kept (see `copy`), and nothing is read
//! unless macOS lets Compose read other apps' copies without asking.

mod copy;
#[cfg(target_os = "macos")]
mod mac;
#[cfg(target_os = "macos")]
mod watch;

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU8, Ordering};

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

/// Whether history is on, what macOS lets it read, and the clipboard's change
/// counter at the last look.
#[derive(Default)]
pub struct ClipboardHistory {
    enabled: AtomicBool,
    access: AtomicU8,
    seen: AtomicIsize,
}

impl ClipboardHistory {
    fn access(&self) -> ClipboardAccess {
        ClipboardAccess::from_u8(self.access.load(Ordering::SeqCst))
    }

    /// Note what macOS lets Compose read; `true` when that changed.
    fn record_access(&self, access: ClipboardAccess) -> bool {
        self.access.swap(access as u8, Ordering::SeqCst) != access as u8
    }
}

/// What macOS lets Compose read of other apps' copies, as the user set it in
/// Privacy & Security → Paste from Other Apps.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[repr(u8)]
pub enum ClipboardAccess {
    #[default]
    Allowed = 0,
    /// macOS asks at every read, so a history would prompt at every copy.
    Asks = 1,
    Denied = 2,
}

impl ClipboardAccess {
    fn from_u8(value: u8) -> Self {
        match value {
            0 => Self::Allowed,
            2 => Self::Denied,
            _ => Self::Asks,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardHistoryView {
    pub enabled: bool,
    pub access: ClipboardAccess,
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
        access: history.access(),
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

/// Open Privacy & Security → Paste from Other Apps, where the user lets Compose
/// read what other apps copy.
#[tauri::command(async)]
pub fn clipboard_privacy_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return mac::open_privacy_settings();
    #[cfg(not(target_os = "macos"))]
    Err("Clipboard history needs macOS.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_change_in_what_macos_allows_is_noticed_once() {
        let history = ClipboardHistory::default();
        assert_eq!(history.access(), ClipboardAccess::Allowed);
        assert!(!history.record_access(ClipboardAccess::Allowed));
        assert!(history.record_access(ClipboardAccess::Asks));
        assert!(!history.record_access(ClipboardAccess::Asks));
        assert_eq!(history.access(), ClipboardAccess::Asks);
        assert!(history.record_access(ClipboardAccess::Denied));
        assert_eq!(history.access(), ClipboardAccess::Denied);
    }

    #[test]
    fn the_window_is_told_what_macos_allows() {
        let view = ClipboardHistoryView { enabled: true, access: ClipboardAccess::Asks, items: Vec::new() };
        assert_eq!(
            serde_json::to_value(view).expect("json"),
            serde_json::json!({ "enabled": true, "access": "asks", "items": [] })
        );
    }
}
