//! The macOS half: the app group this build was signed into, and a watch on the
//! inbox inside its container.

use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::ptr::NonNull;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use objc2_core_foundation::{CFArray, CFRetained, CFString, CFType};
use objc2_foundation::{NSFileManager, NSString};
use tauri::{AppHandle, Emitter, Manager};

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
    let Ok(mut watcher) = state.watcher.lock() else {
        return;
    };
    *watcher = watch(app.clone(), &inbox_dir);
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
    let value = NonNull::new(unsafe {
        SecTaskCopyValueForEntitlement(&task, &key, std::ptr::null_mut())
    })
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

fn watch(app: AppHandle, dir: &Path) -> Option<RecommendedWatcher> {
    if let Err(error) = std::fs::create_dir_all(dir) {
        eprintln!("share inbox could not be created: {error}");
        return None;
    }
    notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        if event.is_ok() {
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
