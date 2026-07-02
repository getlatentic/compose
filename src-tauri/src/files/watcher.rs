use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

use super::is_ignored_segment;

pub const WORKSPACE_FS_EVENT: &str = "workspace_fs";
const DEBOUNCE_WINDOW: Duration = Duration::from_millis(150);
const RECV_TIMEOUT: Duration = Duration::from_millis(50);
/// Backoff between attempts to (re)establish a broken watcher. Bounded: after
/// the last slot the workspace gives up and emits `watch-error` (the UI tells
/// the user watching stopped) rather than spinning forever.
const ESTABLISH_BACKOFF: [Duration; 5] = [
    Duration::from_secs(1),
    Duration::from_millis(2500),
    Duration::from_secs(5),
    Duration::from_secs(5),
    Duration::from_secs(5),
];
/// While the workspace ROOT itself is missing (iCloud eviction, unmounted
/// volume), poll for its return indefinitely at this cadence — cheap stat,
/// and the vault coming back must resume watching without user action.
const ROOT_MONITOR_INTERVAL: Duration = Duration::from_secs(5);
/// Granularity for stop-flag checks while sleeping, so `stop_watcher` (and app
/// quit) never waits out a full backoff interval.
const SLEEP_SLICE: Duration = Duration::from_millis(200);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherEventPayload {
    pub kind: &'static str,
    pub last_modified_ms: Option<i64>,
    pub relative_path: String,
    pub workspace_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_dir: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size_bytes: Option<u64>,
}

impl WatcherEventPayload {
    /// A tree-wide control signal (`rescan` / `watch-error`) rather than a
    /// change to one path.
    fn control(kind: &'static str, workspace_id: &str) -> Self {
        Self {
            kind,
            last_modified_ms: None,
            relative_path: String::new(),
            workspace_id: workspace_id.to_owned(),
            is_dir: None,
            size_bytes: None,
        }
    }
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
    stop: Arc<AtomicBool>,
    _join: Option<JoinHandle<()>>,
}

impl Drop for WatcherHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
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

        let stop = Arc::new(AtomicBool::new(false));
        let workspace_id_owned = workspace_id.to_owned();
        let root_owned = root.to_path_buf();
        let thread_stop = Arc::clone(&stop);
        // The thread owns the notify watcher's whole lifecycle (establish → run
        // → re-establish), so a dead event stream or a vanished root recovers
        // in place instead of going silently stale.
        let join = thread::spawn(move || {
            watch_workspace(workspace_id_owned, root_owned, app, thread_stop);
        });

        inner.handles.insert(
            workspace_id.to_owned(),
            WatcherHandle { stop, _join: Some(join) },
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

/// The lifetime of one workspace's watching: establish a native watcher,
/// pump its events, and on any break (stream error, dead channel, vanished
/// root) re-establish with bounded backoff — emitting a synthetic `rescan`
/// after every gap so changes we missed while blind get reconciled.
fn watch_workspace(workspace_id: String, root: PathBuf, app: AppHandle, stop: Arc<AtomicBool>) {
    let mut establish_attempt: usize = 0;
    // The boot scan already reflects disk at subscribe time, so the first
    // successful watch needs no reconcile; every RE-establish does.
    let mut watched_before = false;

    loop {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        // A missing root isn't an error to back off from — it's the vault being
        // away (iCloud eviction, unmount). Monitor cheaply until it returns.
        if !root.exists() {
            if !sleep_unless_stopped(&stop, ROOT_MONITOR_INTERVAL) {
                return;
            }
            continue;
        }

        let (event_tx, event_rx) = channel::<notify::Result<Event>>();
        let watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
            let _ = event_tx.send(event);
        })
        .and_then(|mut watcher| {
            watcher.watch(&root, RecursiveMode::Recursive).map(|()| watcher)
        });

        let watcher = match watcher {
            Ok(watcher) => watcher,
            Err(error) => {
                eprintln!("watcher establish failed for {workspace_id}: {error}");
                let Some(backoff) = ESTABLISH_BACKOFF.get(establish_attempt) else {
                    let _ = app.emit(
                        WORKSPACE_FS_EVENT,
                        WatcherEventPayload::control("watch-error", &workspace_id),
                    );
                    return;
                };
                establish_attempt += 1;
                if !sleep_unless_stopped(&stop, *backoff) {
                    return;
                }
                continue;
            }
        };
        establish_attempt = 0;
        if watched_before {
            let _ = app.emit(
                WORKSPACE_FS_EVENT,
                WatcherEventPayload::control("rescan", &workspace_id),
            );
        }
        watched_before = true;

        let outcome = run_watcher_loop(&workspace_id, &root, &app, &stop, event_rx);
        // Dropping the watcher before re-establishing releases its native
        // resources (FSEvents stream / inotify descriptors).
        drop(watcher);
        match outcome {
            LoopOutcome::Stopped => return,
            LoopOutcome::StreamBroken => {
                // Loop back to re-establish (with the root-missing monitor
                // catching the vanished-vault case first).
            }
        }
    }
}

enum LoopOutcome {
    /// `stop_watcher` (or app teardown) asked us to end.
    Stopped,
    /// The event stream broke (watcher error or dead channel) — re-establish.
    StreamBroken,
}

fn run_watcher_loop(
    workspace_id: &str,
    root: &Path,
    app: &AppHandle,
    stop: &AtomicBool,
    event_rx: Receiver<notify::Result<Event>>,
) -> LoopOutcome {
    let mut pending: HashMap<PathBuf, &'static str> = HashMap::new();
    let mut last_event_at: Option<Instant> = None;

    loop {
        if stop.load(Ordering::Relaxed) {
            return LoopOutcome::Stopped;
        }
        match event_rx.recv_timeout(RECV_TIMEOUT) {
            Ok(Ok(event)) => {
                // notify raises this flag when its event queue overflowed —
                // events were LOST and the tree may have silently diverged.
                // Surface it as a tree-wide rescan instead of ignoring it.
                if event.need_rescan() {
                    let _ = app.emit(
                        WORKSPACE_FS_EVENT,
                        WatcherEventPayload::control("rescan", workspace_id),
                    );
                }
                if let Some(kind) = classify_event_kind(&event.kind) {
                    for path in event.paths {
                        if path == root {
                            // The root itself changed shape (removed/renamed):
                            // the recursive watch is now dubious — re-establish
                            // (the monitor loop waits out a missing root).
                            if kind == "removed" {
                                flush_pending(workspace_id, root, app, &mut pending);
                                return LoopOutcome::StreamBroken;
                            }
                            continue;
                        }
                        pending
                            .entry(path)
                            .and_modify(|existing| *existing = merge_pending_kind(existing, kind))
                            .or_insert(kind);
                    }
                    last_event_at = Some(Instant::now());
                }
            }
            Ok(Err(error)) => {
                eprintln!("watcher stream error for {workspace_id}: {error}");
                flush_pending(workspace_id, root, app, &mut pending);
                return LoopOutcome::StreamBroken;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                flush_pending(workspace_id, root, app, &mut pending);
                return if stop.load(Ordering::Relaxed) {
                    LoopOutcome::Stopped
                } else {
                    LoopOutcome::StreamBroken
                };
            }
        }

        if let Some(at) = last_event_at {
            if at.elapsed() >= DEBOUNCE_WINDOW && !pending.is_empty() {
                flush_pending(workspace_id, root, app, &mut pending);
                last_event_at = None;
            }
        }
    }
}

/// Sleep in stop-checkable slices. Returns false when stopped mid-sleep.
fn sleep_unless_stopped(stop: &AtomicBool, duration: Duration) -> bool {
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        if stop.load(Ordering::Relaxed) {
            return false;
        }
        thread::sleep(SLEEP_SLICE.min(deadline.saturating_duration_since(Instant::now())));
    }
    !stop.load(Ordering::Relaxed)
}

/// Merge a path's queued kind with a newer event inside one debounce window.
/// FSEvents interleaves content/metadata modifications with the structural
/// event for the same path — a brand-new file arrives as Create+Modify, and an
/// unlink can arrive as Remove+Modify(metadata) — so "modified" never demotes
/// a structural kind (both were caught live as notes that never appeared /
/// never disappeared). Structural successions take the newest kind: remove-
/// then-recreate is a creation; create-then-remove is a removal (a harmless
/// no-op for a path never shown).
fn merge_pending_kind(existing: &'static str, incoming: &'static str) -> &'static str {
    if incoming == "modified" && existing != "modified" {
        existing
    } else {
        incoming
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

/// Whether a path's event reaches the frontend. Notes (`.md`) always do.
/// Directory events matter too — the tree shows folders — but a removed path
/// can't be stat'd, so removals pass through on the no-extension heuristic and
/// the frontend resolves them against the files/folders it actually knows.
/// (A removed folder NAMED like a file, e.g. `Notes.backup`, is missed here —
/// the focus-refresh rescan reconciles those rare cases.)
fn should_emit(kind: &str, path: &Path, is_dir: Option<bool>) -> bool {
    let is_md = path.extension().and_then(|ext| ext.to_str()) == Some("md");
    match kind {
        "modified" => is_md && is_dir != Some(true),
        "created" => is_md || is_dir == Some(true),
        "removed" => is_md || path.extension().is_none(),
        _ => false,
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
        if relative.split('/').any(is_ignored_segment) {
            continue;
        }

        let metadata = std::fs::metadata(&path).ok();
        let is_dir = metadata.as_ref().map(|metadata| metadata.is_dir());
        if !should_emit(kind, &path, is_dir) {
            continue;
        }

        let last_modified_ms = metadata
            .as_ref()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as i64);
        let size_bytes = metadata
            .as_ref()
            .filter(|metadata| metadata.is_file())
            .map(|metadata| metadata.len());

        let payload = WatcherEventPayload {
            kind,
            last_modified_ms,
            relative_path: relative,
            workspace_id: workspace_id.to_owned(),
            is_dir,
            size_bytes,
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

    #[test]
    fn emits_notes_always_and_dirs_by_kind() {
        let note = Path::new("/ws/a.md");
        let dir = Path::new("/ws/Folder");
        let stray = Path::new("/ws/photo.png");

        // Notes: all three kinds.
        assert!(should_emit("created", note, Some(false)));
        assert!(should_emit("modified", note, Some(false)));
        assert!(should_emit("removed", note, None));

        // Directories: create/remove shape the tree; mtime churn is noise.
        assert!(should_emit("created", dir, Some(true)));
        assert!(!should_emit("modified", dir, Some(true)));
        // A removed dir can't be stat'd — passes on the no-extension heuristic.
        assert!(should_emit("removed", dir, None));

        // Non-md files stay invisible.
        assert!(!should_emit("created", stray, Some(false)));
        assert!(!should_emit("modified", stray, Some(false)));
        assert!(!should_emit("removed", stray, None));
    }

    #[test]
    fn a_modify_never_demotes_a_structural_kind() {
        // Both caught live: `> file.md` is Create+Modify (the note never
        // appeared), and an unlink can be Remove+Modify(metadata) (the note
        // never disappeared). The structural kind must survive the window.
        assert_eq!(merge_pending_kind("created", "modified"), "created");
        assert_eq!(merge_pending_kind("removed", "modified"), "removed");
        // Structural successions take the newest kind.
        assert_eq!(merge_pending_kind("removed", "created"), "created");
        assert_eq!(merge_pending_kind("created", "removed"), "removed");
        assert_eq!(merge_pending_kind("modified", "removed"), "removed");
        assert_eq!(merge_pending_kind("modified", "modified"), "modified");
    }

    #[test]
    fn stop_flag_cuts_a_sleep_short() {
        let stop = AtomicBool::new(true);
        let started = Instant::now();
        assert!(!sleep_unless_stopped(&stop, Duration::from_secs(5)));
        assert!(started.elapsed() < Duration::from_secs(1));
    }
}
