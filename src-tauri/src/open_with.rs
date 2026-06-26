use std::sync::Mutex;

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
