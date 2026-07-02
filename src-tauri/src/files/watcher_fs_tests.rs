//! Real-filesystem regression tests for the workspace watcher.
//!
//! The unit tests in `watcher.rs` cover the pure decision helpers; these run
//! the REAL `watch_workspace` loop against a real temp directory with the
//! platform's native watcher (FSEvents on macOS, inotify on Linux), observing
//! exactly what the frontend would receive via a `MockRuntime` listener. They
//! exist because two shipping bugs were invisible to anything mocked:
//!
//!   * `> file.md` arrives as Create+Modify inside one debounce window — the
//!     blind pending-map insert let "modified" clobber "created", so new notes
//!     never appeared;
//!   * a root rename-away arrives as a mere Modify(Name) on the root — the
//!     removed-only check missed it and the watch went silently dead.
//!
//! Timing is injected (`WatcherTiming`) so the identical code paths run in
//! milliseconds; the assertions poll with deadlines rather than sleeping fixed
//! amounts, so a slow CI machine waits longer instead of flaking.

use super::watcher::{watch_workspace, WatcherTiming, WORKSPACE_FS_EVENT};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
use tauri::{App, Listener};
use tempfile::TempDir;

const FAST_BACKOFF: [Duration; 3] = [
    Duration::from_millis(50),
    Duration::from_millis(50),
    Duration::from_millis(50),
];

fn fast_timing() -> WatcherTiming {
    WatcherTiming {
        debounce: Duration::from_millis(25),
        recv_timeout: Duration::from_millis(5),
        monitor_interval: Duration::from_millis(100),
        establish_backoff: &FAST_BACKOFF,
    }
}

/// How long an assertion waits for an expected event before failing. Generous
/// (native watchers have their own latency), but polled — a healthy run exits
/// in tens of milliseconds.
const DEADLINE: Duration = Duration::from_secs(10);
/// A quiet period long enough to be sure a flush (debounce 25ms) has happened.
const SETTLE: Duration = Duration::from_millis(250);

/// A real directory under watch by the real `watch_workspace` loop, with the
/// emitted `workspace_fs` payloads observable as parsed JSON.
struct WatchedDir {
    /// Owns the temp tree; the watched root is `root` inside it (a subdir, so
    /// the rename-away test can move the root without fighting TempDir).
    _tmp: TempDir,
    root: PathBuf,
    _app: App<MockRuntime>,
    events: Receiver<serde_json::Value>,
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

impl Drop for WatchedDir {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

impl WatchedDir {
    fn start() -> Self {
        let tmp = TempDir::new().expect("tempdir");
        let root = tmp.path().join("vault");
        fs::create_dir(&root).expect("create vault root");

        let app = mock_builder()
            .build(mock_context(noop_assets()))
            .expect("build mock app");
        let (event_tx, events) = channel::<serde_json::Value>();
        app.listen_any(WORKSPACE_FS_EVENT, move |event| {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(event.payload()) {
                let _ = event_tx.send(value);
            }
        });

        let stop = Arc::new(AtomicBool::new(false));
        let handle = app.handle().clone();
        let thread_root = root.clone();
        let thread_stop = Arc::clone(&stop);
        let join = thread::spawn(move || {
            watch_workspace(
                "wtest".to_owned(),
                thread_root,
                handle,
                thread_stop,
                fast_timing(),
            );
        });

        let watched = Self {
            _tmp: tmp,
            root,
            _app: app,
            events,
            stop,
            join: Some(join),
        };
        watched.await_watching();
        watched
    }

    /// The watcher establishes asynchronously; fs ops issued before the native
    /// stream is live would be silently missed. Probe with real files until one
    /// is observed, then remove it and drain — deterministic, no fixed sleep.
    fn await_watching(&self) {
        let deadline = Instant::now() + DEADLINE;
        let mut probe = 0;
        while Instant::now() < deadline {
            probe += 1;
            let name = format!("probe-{probe}.md");
            fs::write(self.root.join(&name), "probe").expect("write probe");
            let seen = self
                .collect_until(Duration::from_millis(300), |events| {
                    events.iter().any(|event| {
                        event["relativePath"].as_str() == Some(name.as_str())
                    })
                })
                .is_some();
            let _ = fs::remove_file(self.root.join(&name));
            if seen {
                self.settle();
                return;
            }
        }
        panic!("watcher never became live within {DEADLINE:?}");
    }

    /// Collect events until `done(collected)` says so; None on deadline.
    fn collect_until(
        &self,
        deadline: Duration,
        done: impl Fn(&[serde_json::Value]) -> bool,
    ) -> Option<Vec<serde_json::Value>> {
        let until = Instant::now() + deadline;
        let mut collected = Vec::new();
        loop {
            if done(&collected) {
                return Some(collected);
            }
            let now = Instant::now();
            if now >= until {
                return None;
            }
            if let Ok(event) = self
                .events
                .recv_timeout((until - now).min(Duration::from_millis(50)))
            {
                collected.push(event);
            }
        }
    }

    /// Wait (bounded by DEADLINE) for an event matching the predicate; returns
    /// everything seen up to and including it.
    fn expect_event(
        &self,
        what: &str,
        matched: impl Fn(&serde_json::Value) -> bool,
    ) -> Vec<serde_json::Value> {
        match self.collect_until(DEADLINE, |events| events.iter().any(&matched)) {
            Some(events) => events,
            None => panic!("expected {what} within {DEADLINE:?}"),
        }
    }

    /// Drain until the stream stays quiet for SETTLE — isolates test phases.
    fn settle(&self) {
        while self.events.recv_timeout(SETTLE).is_ok() {}
    }
}

fn kind_of(event: &serde_json::Value) -> &str {
    event["kind"].as_str().unwrap_or("")
}
fn path_of(event: &serde_json::Value) -> &str {
    event["relativePath"].as_str().unwrap_or("")
}

#[test]
fn seam_probe_emit_reaches_listen_any() {
    use tauri::Emitter;
    let app = mock_builder()
        .build(mock_context(noop_assets()))
        .expect("build mock app");
    let (tx, rx) = channel::<String>();
    app.listen_any("probe", move |event| {
        let _ = tx.send(event.payload().to_owned());
    });
    app.emit("probe", "hello").expect("emit");
    let got = rx.recv_timeout(Duration::from_secs(2));
    assert!(got.is_ok(), "emit did not reach listen_any on MockRuntime: {got:?}");
}

#[test]
fn a_new_note_arrives_as_created_never_as_modified() {
    let dir = WatchedDir::start();

    // One write = Create+Modify from the native watcher, one debounce window.
    fs::write(dir.root.join("Note.md"), "# Note\n").expect("write note");

    let events = dir.expect_event("created Note.md", |event| {
        kind_of(event) == "created" && path_of(event) == "Note.md"
    });
    let created = events
        .iter()
        .find(|event| path_of(event) == "Note.md")
        .expect("just matched");
    assert_eq!(created["isDir"], false);
    assert!(created["sizeBytes"].as_u64().unwrap_or(0) > 0);

    // The regression: no "modified" for the same path may have slipped out in
    // that flush (it would be ignored by the tree and the note never appears).
    dir.settle();
    let demoted = events
        .iter()
        .any(|event| path_of(event) == "Note.md" && kind_of(event) == "modified");
    assert!(!demoted, "the write demoted the creation to modified: {events:?}");
}

#[test]
fn an_unlink_arrives_as_removed_despite_metadata_noise() {
    let dir = WatchedDir::start();
    fs::write(dir.root.join("Gone.md"), "x").expect("write");
    dir.expect_event("created Gone.md", |event| {
        kind_of(event) == "created" && path_of(event) == "Gone.md"
    });
    dir.settle();

    fs::remove_file(dir.root.join("Gone.md")).expect("remove");
    dir.expect_event("removed Gone.md", |event| {
        kind_of(event) == "removed" && path_of(event) == "Gone.md"
    });
}

#[test]
fn a_folder_and_its_rm_rf_reach_the_frontend() {
    let dir = WatchedDir::start();

    fs::create_dir(dir.root.join("Sub")).expect("mkdir");
    let events = dir.expect_event("created Sub", |event| {
        kind_of(event) == "created" && path_of(event) == "Sub"
    });
    let created = events.iter().find(|event| path_of(event) == "Sub").expect("matched");
    assert_eq!(created["isDir"], true);
    dir.settle();

    fs::write(dir.root.join("Sub/in.md"), "x").expect("write nested");
    dir.expect_event("created Sub/in.md", |event| {
        kind_of(event) == "created" && path_of(event) == "Sub/in.md"
    });
    dir.settle();

    // The live-caught ghost: rm -rf must surface as removals, not vanish into
    // demoted "modified" events.
    fs::remove_dir_all(dir.root.join("Sub")).expect("rm -rf");
    dir.expect_event("removed Sub", |event| {
        kind_of(event) == "removed" && path_of(event) == "Sub"
    });
}

#[test]
fn non_markdown_files_stay_invisible() {
    let dir = WatchedDir::start();

    fs::write(dir.root.join("photo.png"), [0x89, b'P']).expect("write png");
    // Bound the wait with a sentinel note written AFTER the png: once the
    // sentinel's event arrives, the png's flush window is long past.
    fs::write(dir.root.join("sentinel.md"), "x").expect("write sentinel");

    let events = dir.expect_event("created sentinel.md", |event| {
        kind_of(event) == "created" && path_of(event) == "sentinel.md"
    });
    assert!(
        !events.iter().any(|event| path_of(event).contains("photo.png")),
        "a non-md file leaked into the event stream: {events:?}"
    );
}

#[test]
fn a_root_renamed_away_and_back_recovers_with_a_rescan() {
    let dir = WatchedDir::start();
    let away = dir.root.with_file_name("vault-away");

    // Rename the root aside — this arrives as Modify(Name) on the root, not a
    // removal (the live-caught silent-death case).
    fs::rename(&dir.root, &away).expect("rename root away");
    // The absence must outlive one event-poll tick to be noticed, as any real
    // unmount/eviction does (seconds). Renaming back within the same debounce
    // window would be a sub-150ms flicker no user can produce.
    thread::sleep(Duration::from_millis(300));
    // A note lands while the watcher is blind.
    fs::write(away.join("Ghosted.md"), "x").expect("write while away");
    fs::rename(&away, &dir.root).expect("rename root back");

    // The monitor must re-establish and announce the gap so the frontend runs
    // one reconciling scan (which would surface Ghosted.md).
    dir.expect_event("a rescan after the root returned", |event| {
        kind_of(event) == "rescan"
    });
}
