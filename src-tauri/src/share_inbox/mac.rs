//! The macOS half: a watch on the inbox, and keeping the app awake to file what
//! arrives.

use std::path::Path;
use std::sync::Arc;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use objc2::rc::Retained;
use objc2::runtime::{NSObjectProtocol, ProtocolObject};
use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};
use tauri::{AppHandle, Emitter, Manager};

use super::awake::{Awake, MAX_AWAKE};
use super::inbox::Inbox;
use super::{ShareInboxState, SHARE_INBOX_EVENT};

pub(super) fn start(app: &AppHandle) {
    let Some(dir) = crate::app_group::shared_dir() else {
        return;
    };
    let inbox = Inbox::new(dir.to_path_buf());
    let state = app.state::<ShareInboxState>();
    let inbox_dir = inbox.inbox_dir();
    let _ = state.inbox.set(inbox);
    let awake = Arc::clone(state.awake.get_or_init(|| Arc::new(awake())));
    let Ok(mut watcher) = state.watcher.lock() else {
        return;
    };
    *watcher = watch(app.clone(), &inbox_dir, awake);
}

/// An activity begun with `NSProcessInfo`, ended when the hold is released.
pub(super) struct Activity(Retained<ProtocolObject<dyn NSObjectProtocol>>);

// Activities may be begun and ended on any thread: this one is taken on the file
// watcher's thread and released on a command's.
unsafe impl Send for Activity {}

fn awake() -> Awake<Activity> {
    Awake::new(
        Box::new(|| {
            let reason = NSString::from_str("Filing a clip shared to Compose");
            Some(Activity(
                NSProcessInfo::processInfo().beginActivityWithOptions_reason(
                    NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
                    &reason,
                ),
            ))
        }),
        std::sync::Arc::new(|activity: Activity| unsafe {
            NSProcessInfo::processInfo().endActivity(&activity.0);
        }),
        MAX_AWAKE,
    )
}

fn watch(app: AppHandle, dir: &Path, awake: Arc<Awake<Activity>>) -> Option<RecommendedWatcher> {
    if let Err(error) = std::fs::create_dir_all(dir) {
        eprintln!("share inbox could not be created: {error}");
        return None;
    }
    notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_ok() {
            // Before the event is sent: delivering it is the first thing a
            // napping app would hold back.
            awake.hold();
            let _ = app.emit(SHARE_INBOX_EVENT, ());
        }
    })
    .and_then(|mut watcher| {
        watcher
            .watch(dir, RecursiveMode::NonRecursive)
            .map(|()| watcher)
    })
    .inspect_err(|error| eprintln!("share inbox is not watched: {error}"))
    .ok()
}
