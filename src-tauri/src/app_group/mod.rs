//! The folder Compose shares with its extensions — Share, Shortcuts and the
//! widget — inside the app-group container both sides are signed into. The
//! extensions are sandboxed and cannot read the app's settings or database, so
//! the app publishes what they need there: the workspaces, and the notes
//! changed most recently, redrawing the widgets whenever either changes. A
//! build not signed into the group — a development build, or any build off
//! macOS — has no such folder and publishes nothing.

#[cfg(target_os = "macos")]
mod container;
pub mod contract;
mod notes;
mod publish;
mod widgets;

use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager};

use crate::db::MetadataStore;
use crate::workspace::{WorkspaceList, WorkspaceRegistry};
use contract::Destinations;

const SHARED_DIR: &str = "Share";
/// Saving comes in bursts while the user types: the notes are published once
/// saves stop for this long,
const QUIET: Duration = Duration::from_secs(2);
/// or this long after the first, whichever comes sooner.
const LONGEST_WAIT: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct AppGroupState {
    notes_changed: OnceLock<Sender<()>>,
}

/// The folder the app and its extensions share, when this build was signed
/// into the group.
pub fn shared_dir() -> Option<&'static Path> {
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(|| {
        #[cfg(target_os = "macos")]
        return container::locate().map(|container| container.join(SHARED_DIR));
        #[cfg(not(target_os = "macos"))]
        None
    })
    .as_deref()
}

/// Publish the workspaces and notes, and keep both current.
pub fn start(app: &AppHandle) {
    let Some(dir) = shared_dir() else {
        return;
    };
    let (sender, changes) = mpsc::channel();
    let publisher = app.clone();
    std::thread::spawn(move || {
        while settle(&changes, QUIET, LONGEST_WAIT) {
            publish_notes(&publisher, dir);
        }
    });
    let _ = sender.send(());
    let _ = app.state::<AppGroupState>().notes_changed.set(sender);

    let registry = app.state::<WorkspaceRegistry>();
    if let Ok(list) = registry.list() {
        publish_destinations(dir, &list);
    }
    let observer = app.clone();
    registry.observe_list(move |list| {
        publish_destinations(dir, list);
        notes_changed(&observer);
    });
}

/// A note was written, renamed, deleted or rescanned.
pub fn notes_changed(app: &AppHandle) {
    if let Some(sender) = app.state::<AppGroupState>().notes_changed.get() {
        let _ = sender.send(());
    }
}

/// Wait for a change, then for the burst it starts to end. `false` once no more
/// can come.
fn settle(changes: &Receiver<()>, quiet: Duration, longest: Duration) -> bool {
    if changes.recv().is_err() {
        return false;
    }
    let first = Instant::now();
    while first.elapsed() < longest && changes.recv_timeout(quiet).is_ok() {}
    true
}

fn publish_destinations(dir: &Path, list: &WorkspaceList) {
    match publish::publish(dir, publish::DESTINATIONS_FILE, &Destinations::from_list(list)) {
        Ok(true) => widgets::reload(),
        Ok(false) => {}
        Err(error) => eprintln!("workspaces were not published for the extensions: {error}"),
    }
}

fn publish_notes(app: &AppHandle, dir: &Path) {
    let Ok(list) = app.state::<WorkspaceRegistry>().list() else {
        return;
    };
    let index = notes::index(&list, &app.state::<MetadataStore>());
    match publish::publish(dir, publish::NOTES_FILE, &index) {
        Ok(true) => widgets::reload(),
        Ok(false) => {}
        Err(error) => eprintln!("notes were not published for the extensions: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_burst_of_changes_is_published_once() {
        let (sender, changes) = mpsc::channel();
        for _ in 0..5 {
            sender.send(()).expect("send");
        }
        assert!(settle(&changes, Duration::from_millis(20), Duration::from_secs(5)));
        assert!(changes.try_recv().is_err(), "the whole burst was taken in");
        drop(sender);
        assert!(!settle(&changes, Duration::from_millis(20), Duration::from_secs(5)));
    }

    #[test]
    fn changes_that_never_stop_are_still_published() {
        let (sender, changes) = mpsc::channel();
        sender.send(()).expect("first");
        let typing = std::thread::spawn(move || {
            for _ in 0..100 {
                if sender.send(()).is_err() {
                    return;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        });
        let started = Instant::now();
        assert!(settle(&changes, Duration::from_millis(50), Duration::from_millis(100)));
        assert!(started.elapsed() < Duration::from_millis(400), "took {:?}", started.elapsed());
        drop(changes);
        typing.join().expect("typing");
    }
}
