//! The macOS half: the app group this build was signed into, and a watch on the
//! inbox inside its container.

use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use std::sync::Arc;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use objc2::rc::Retained;
use objc2::runtime::{NSObjectProtocol, ProtocolObject};
use objc2_core_foundation::{CFArray, CFRetained, CFString, CFType};
use objc2_foundation::{NSActivityOptions, NSFileManager, NSProcessInfo, NSString};
use tauri::{AppHandle, Emitter, Manager};

use super::awake::{Awake, MAX_AWAKE};
use super::inbox::Inbox;
use super::{ShareInboxState, SHARE_INBOX_EVENT};
use crate::workspace::{WorkspaceList, WorkspaceRegistry};

const APP_GROUPS_ENTITLEMENT: &str = "com.apple.security.application-groups";
const SHARE_DIR: &str = "Share";

#[link(name = "Security", kind = "framework")]
extern "C" {
    fn SecTaskCreateFromSelf(allocator: *const c_void) -> *mut CFType;
    fn SecTaskCopyValueForEntitlement(
        task: &CFType,
        entitlement: &CFString,
        error: *mut *mut c_void,
    ) -> *mut CFType;
}

pub(super) fn start(app: &AppHandle) {
    let Some(inbox) = locate() else {
        return;
    };
    let registry = app.state::<WorkspaceRegistry>();
    if let Ok(list) = registry.list() {
        publish(&inbox, &list);
    }
    let observed = inbox.clone();
    registry.observe_list(move |list| publish(&observed, list));

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

fn locate() -> Option<Inbox> {
    let group = own_app_group()?;
    let container = NSFileManager::defaultManager()
        .containerURLForSecurityApplicationGroupIdentifier(&NSString::from_str(&group))?;
    let path = container.path()?.to_string();
    Some(Inbox::new(PathBuf::from(path).join(SHARE_DIR)))
}

/// The app group this process was signed into, read from its own signature so
/// it cannot disagree with the entitlement that grants access to the container.
fn own_app_group() -> Option<String> {
    let task = NonNull::new(unsafe { SecTaskCreateFromSelf(std::ptr::null()) })
        .map(|task| unsafe { CFRetained::from_raw(task) })?;
    let key = CFString::from_str(APP_GROUPS_ENTITLEMENT);
    let value =
        NonNull::new(unsafe { SecTaskCopyValueForEntitlement(&task, &key, std::ptr::null_mut()) })
            .map(|value| unsafe { CFRetained::from_raw(value) })?;
    let groups = value.downcast_ref::<CFArray>()?;
    (0..groups.count()).find_map(|index| {
        let item = unsafe { groups.value_at_index(index) }.cast::<CFType>();
        unsafe { item.as_ref() }?
            .downcast_ref::<CFString>()
            .map(ToString::to_string)
    })
}

fn publish(inbox: &Inbox, list: &WorkspaceList) {
    if let Err(error) = inbox.publish_destinations(list) {
        eprintln!("share destinations were not published: {error}");
    }
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
