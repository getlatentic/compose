use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

const OPEN_EVENT: &str = "compose:open-external-file";

/// Open `path` as a file handed to the app from outside: kept until a frontend
/// that mounts later drains it, and told at once to one already running.
pub fn open_in_app(app: &AppHandle, path: String) {
    app.state::<PendingOpenUrls>().push(path.clone());
    let _ = app.emit(OPEN_EVENT, path);
}

#[derive(Default)]
pub struct PendingOpenUrls(Mutex<Vec<String>>);

impl PendingOpenUrls {
    pub fn push(&self, path: String) {
        if let Ok(mut guard) = self.0.lock() {
            guard.push(path);
        }
    }

    pub fn drain(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|mut guard| std::mem::take(&mut *guard))
            .unwrap_or_default()
    }
}

#[tauri::command]
pub fn drain_pending_open_urls(state: tauri::State<'_, PendingOpenUrls>) -> Vec<String> {
    state.drain()
}
