use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

use super::is_ignored_segment;

pub const WORKSPACE_FS_EVENT: &str = "workspace_fs";
const DEBOUNCE_WINDOW: Duration = Duration::from_millis(150);
const RECV_TIMEOUT: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherEventPayload {
    pub kind: &'static str,
    pub last_modified_ms: Option<i64>,
    pub relative_path: String,
    pub workspace_id: String,
}

#[derive(Default)]
pub struct WatcherManager {
    inner: Mutex<WatcherManagerInner>,
}

#[derive(Default)]
struct WatcherManagerInner {
    app: Option<AppHandle>,
    handles: HashMap<String, WatcherHandle>,
}

struct WatcherHandle {
    _watcher: RecommendedWatcher,
    _join: Option<JoinHandle<()>>,
}

impl WatcherManager {
    pub fn init(&self, app: AppHandle) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "watcher manager lock poisoned".to_owned())?;
        inner.app = Some(app);
        Ok(())
    }

    pub fn ensure_watcher(&self, workspace_id: &str, root: &Path) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "watcher manager lock poisoned".to_owned())?;
        if inner.handles.contains_key(workspace_id) {
            return Ok(());
        }
        let app = inner
            .app
            .clone()
            .ok_or_else(|| "watcher manager not initialized".to_owned())?;

        let (event_tx, event_rx) = channel::<notify::Result<Event>>();
        let mut watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
            let _ = event_tx.send(event);
        })
        .map_err(|error| error.to_string())?;
        watcher
            .watch(root, RecursiveMode::Recursive)
            .map_err(|error| error.to_string())?;

        let workspace_id_owned = workspace_id.to_owned();
        let root_owned = root.to_path_buf();
        let join = thread::spawn(move || {
            run_watcher_loop(workspace_id_owned, root_owned, app, event_rx);
        });

        inner.handles.insert(
            workspace_id.to_owned(),
            WatcherHandle {
                _watcher: watcher,
                _join: Some(join),
            },
        );
        Ok(())
    }

    pub fn stop_watcher(&self, workspace_id: &str) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        inner.handles.remove(workspace_id);
    }
}

fn run_watcher_loop(
    workspace_id: String,
    root: PathBuf,
    app: AppHandle,
    event_rx: Receiver<notify::Result<Event>>,
) {
    let mut pending: HashMap<PathBuf, &'static str> = HashMap::new();
    let mut last_event_at: Option<Instant> = None;

    loop {
        match event_rx.recv_timeout(RECV_TIMEOUT) {
            Ok(Ok(event)) => {
                let kind = classify_event_kind(&event.kind);
                if let Some(kind) = kind {
                    for path in event.paths {
                        pending.insert(path, kind);
                    }
                    last_event_at = Some(Instant::now());
                }
            }
            Ok(Err(_)) => {}
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                if !pending.is_empty() {
                    flush_pending(&workspace_id, &root, &app, &mut pending);
                }
                return;
            }
        }

        if let Some(at) = last_event_at {
            if at.elapsed() >= DEBOUNCE_WINDOW && !pending.is_empty() {
                flush_pending(&workspace_id, &root, &app, &mut pending);
                last_event_at = None;
            }
        }
    }
}

fn classify_event_kind(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("created"),
        EventKind::Modify(_) => Some("modified"),
        EventKind::Remove(_) => Some("removed"),
        _ => None,
    }
}

fn flush_pending(
    workspace_id: &str,
    root: &Path,
    app: &AppHandle,
    pending: &mut HashMap<PathBuf, &'static str>,
) {
    let drained: Vec<(PathBuf, &'static str)> = pending.drain().collect();
    for (path, kind) in drained {
        let Some(relative) = relative_workspace_path(root, &path) else {
            continue;
        };
        if relative.is_empty() {
            continue;
        }
        if relative
            .split('/')
            .any(is_ignored_segment)
        {
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }

        let last_modified_ms = std::fs::metadata(&path)
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64);

        let payload = WatcherEventPayload {
            kind,
            last_modified_ms,
            relative_path: relative,
            workspace_id: workspace_id.to_owned(),
        };
        // Broadcast: filesystem changes are inherently global to whichever
        // windows are looking at this workspace. The payload carries
        // `workspace_id`, and each window's store discards events for any
        // workspace it isn't viewing — so two windows on the same folder
        // both refresh, and a window on a different folder ignores it.
        // (Per-window routing here would re-introduce the desync the
        // workspace-id filter already prevents.)
        let _ = app.emit(WORKSPACE_FS_EVENT, payload);
    }
}

fn relative_workspace_path(root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_recognizes_known_event_kinds() {
        use notify::event::{CreateKind, ModifyKind, RemoveKind};
        assert_eq!(
            classify_event_kind(&EventKind::Create(CreateKind::File)),
            Some("created")
        );
        assert_eq!(
            classify_event_kind(&EventKind::Modify(ModifyKind::Any)),
            Some("modified")
        );
        assert_eq!(
            classify_event_kind(&EventKind::Remove(RemoveKind::File)),
            Some("removed")
        );
        assert_eq!(classify_event_kind(&EventKind::Other), None);
    }

    #[test]
    fn relative_path_normalizes_separators() {
        let root = PathBuf::from("/tmp/ws");
        let path = PathBuf::from("/tmp/ws/notes/launch.md");
        let relative = relative_workspace_path(&root, &path).expect("inside root");
        assert_eq!(relative, "notes/launch.md");
    }
}
