//! Where the app-group container is, read from this build's own signature.

use std::ffi::c_void;
use std::path::PathBuf;
use std::ptr::NonNull;

use objc2_core_foundation::{CFArray, CFRetained, CFString, CFType};
use objc2_foundation::{NSFileManager, NSString};

const APP_GROUPS_ENTITLEMENT: &str = "com.apple.security.application-groups";

#[link(name = "Security", kind = "framework")]
extern "C" {
    fn SecTaskCreateFromSelf(allocator: *const c_void) -> *mut CFType;
    fn SecTaskCopyValueForEntitlement(
        task: &CFType,
        entitlement: &CFString,
        error: *mut *mut c_void,
    ) -> *mut CFType;
}

/// The container of the app group this process was signed into.
pub(super) fn locate() -> Option<PathBuf> {
    let group = own_app_group()?;
    let container = NSFileManager::defaultManager()
        .containerURLForSecurityApplicationGroupIdentifier(&NSString::from_str(&group))?;
    Some(PathBuf::from(container.path()?.to_string()))
}

/// Read from the signature so it cannot disagree with the entitlement that
/// grants access to the container.
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
