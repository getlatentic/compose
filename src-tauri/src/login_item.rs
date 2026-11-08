//! What runs at login: Compose itself, so the quick note's shortcuts work from
//! the moment the user logs in, and the shortcuts helper, which keeps them
//! working while Compose is not running. macOS keeps each switch — the user can
//! flip it under System Settings → General → Login Items — so it is read from
//! there every time.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Service {
    App,
    ShortcutsHelper,
}

impl Service {
    fn code(self) -> i32 {
        match self {
            Self::App => 0,
            Self::ShortcutsHelper => 1,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LoginItem {
    Off,
    On,
    /// Registered, but switched off under Login Items: only the user can allow it.
    NeedsApproval,
}

impl LoginItem {
    /// `None` where the item cannot run at login: before macOS 13, or a build
    /// without the helper.
    fn from_code(code: i32) -> Option<Self> {
        match code {
            0 => Some(Self::Off),
            1 => Some(Self::On),
            2 => Some(Self::NeedsApproval),
            _ => None,
        }
    }
}

/// Whether `service` runs at login; `None` where it cannot.
#[tauri::command]
pub fn login_item_status(service: Service) -> Option<LoginItem> {
    native::status(service.code()).and_then(LoginItem::from_code)
}

#[tauri::command]
pub fn login_item_set(service: Service, enabled: bool) -> Result<Option<LoginItem>, String> {
    native::set(service.code(), enabled)?;
    Ok(login_item_status(service))
}

#[tauri::command]
pub fn login_item_settings() {
    native::open_settings();
}

/// macOS opened Compose as a login item, so it starts without its window. Only
/// meaningful while the app finishes launching.
pub fn launched_at_login() -> bool {
    native::launched_at_login()
}

#[cfg(compose_native)]
mod native {
    use std::ffi::{c_char, CStr};

    extern "C" {
        fn compose_login_item_status(which: i32) -> i32;
        fn compose_login_item_set(which: i32, enabled: bool) -> *mut c_char;
        fn compose_login_item_settings();
        fn compose_launched_at_login() -> bool;
    }

    // SAFETY, for each call: Swift functions from `native/LoginItem.swift` that
    // take and return plain values.
    pub(super) fn status(which: i32) -> Option<i32> {
        Some(unsafe { compose_login_item_status(which) })
    }

    pub(super) fn set(which: i32, enabled: bool) -> Result<(), String> {
        let failure = unsafe { compose_login_item_set(which, enabled) };
        if failure.is_null() {
            return Ok(());
        }
        // SAFETY: a C string `strdup`ed by Swift, freed here once read.
        let reason = unsafe { CStr::from_ptr(failure) }.to_string_lossy().into_owned();
        unsafe { libc::free(failure.cast()) };
        Err(reason)
    }

    pub(super) fn open_settings() {
        unsafe { compose_login_item_settings() }
    }

    pub(super) fn launched_at_login() -> bool {
        unsafe { compose_launched_at_login() }
    }
}

#[cfg(not(compose_native))]
mod native {
    pub(super) fn status(_which: i32) -> Option<i32> {
        None
    }

    pub(super) fn set(_which: i32, _enabled: bool) -> Result<(), String> {
        Err("Login items are not available in this build.".to_owned())
    }

    pub(super) fn open_settings() {}

    pub(super) fn launched_at_login() -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_native_answer_maps_to_a_state_and_an_unknown_one_to_none() {
        assert_eq!(LoginItem::from_code(0), Some(LoginItem::Off));
        assert_eq!(LoginItem::from_code(1), Some(LoginItem::On));
        assert_eq!(LoginItem::from_code(2), Some(LoginItem::NeedsApproval));
        assert_eq!(LoginItem::from_code(-1), None);
    }

    #[test]
    fn the_front_end_names_each_service_in_camel_case() {
        assert_eq!(serde_json::from_str::<Service>("\"app\"").expect("app"), Service::App);
        assert_eq!(serde_json::from_str::<Service>("\"shortcutsHelper\"").expect("helper"), Service::ShortcutsHelper);
    }

    #[test]
    fn the_state_crosses_to_the_front_end_in_camel_case() {
        assert_eq!(serde_json::to_string(&LoginItem::NeedsApproval).expect("json"), "\"needsApproval\"");
    }
}
