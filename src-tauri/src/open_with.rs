use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

const OPEN_EVENT: &str = "compose:open-external-file";

/// Open `path` as a file handed to the app from outside: kept until the main
/// window's front end drains it — at once when it is running, else when the
/// window it brings up mounts.
pub fn open_in_app(app: &AppHandle, path: String) {
    app.state::<PendingOpenUrls>().push(path);
    let _ = app.emit(OPEN_EVENT, ());
    crate::main_window::ensure(app);
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
