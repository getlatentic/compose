//! Share → Compose: clips the share extension leaves for the app.
//!
//! The extension runs sandboxed and cannot write into a workspace, so it drops
//! each clip — `clip.json` beside its images — into a folder in the app-group
//! container both processes are signed into, and the app files it as a note.
//! The frontend's only part is converting shared HTML with the converter a paste
//! uses; everything that touches disk happens here.

mod awake;
mod contract;
mod import;
mod inbox;
#[cfg(target_os = "macos")]
mod mac;
mod note;

use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, State};

use crate::db::MetadataStore;
use crate::workspace::WorkspaceRegistry;

pub use contract::{ImportedClip, PendingClip};
use inbox::Inbox;

pub const SHARE_INBOX_EVENT: &str = "compose:share-inbox-changed";

#[derive(Default)]
pub struct ShareInboxState {
    inbox: OnceLock<Inbox>,
    /// Kept for the life of the app: dropping it ends the watch.
    #[cfg(target_os = "macos")]
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
    #[cfg(target_os = "macos")]
    awake: OnceLock<std::sync::Arc<awake::Awake<mac::Activity>>>,
    /// One import at a time, so no clip is filed twice.
    importing: Mutex<()>,
}

impl ShareInboxState {
    /// The page found the inbox empty: nothing is left to keep the app awake for.
    fn settled(&self) {
        #[cfg(target_os = "macos")]
        if let Some(awake) = self.awake.get() {
            awake.release();
        }
    }
}

/// Find the inbox, publish where clips can go and keep that current, and watch
/// for new clips. A build that is not signed into the app group — a development
/// build, or any build off macOS — has no inbox, and sharing is simply off.
pub fn start(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    mac::start(app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[tauri::command(async)]
pub fn share_inbox_pending(state: State<'_, ShareInboxState>) -> Result<Vec<PendingClip>, String> {
    let Some(inbox) = state.inbox.get() else {
        return Ok(Vec::new());
    };
    let clips = inbox.pending().map_err(|error| error.to_string())?;
    if clips.is_empty() {
        state.settled();
    }
    Ok(clips.into_iter().map(PendingClip::from).collect())
}

/// File one clip, with `markdown` as its body — the frontend's conversion of
/// what was shared.
#[tauri::command(async)]
pub fn share_inbox_import(
    clip_id: String,
    markdown: String,
    state: State<'_, ShareInboxState>,
    registry: State<'_, WorkspaceRegistry>,
    metadata: State<'_, MetadataStore>,
) -> Result<Option<ImportedClip>, String> {
    let Some(inbox) = state.inbox.get() else {
        return Ok(None);
    };
    let _one_at_a_time = state
        .importing
        .lock()
        .map_err(|_| "share inbox lock poisoned".to_owned())?;
    import::import_clip(inbox, &clip_id, &markdown, &registry, &metadata)
        .map_err(|error| error.to_string())
}
