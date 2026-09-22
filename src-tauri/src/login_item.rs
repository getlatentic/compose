//! Opening Compose at login, so the quick note's shortcuts work from the moment
//! the user logs in. macOS keeps the switch — the user can flip it under System
//! Settings → General → Login Items — so it is read from there every time.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LoginItem {
    Off,
    On,
    /// Registered, but switched off under Login Items: only the user can allow it.
    NeedsApproval,
}

impl LoginItem {
    /// `None` for a macOS that cannot say, before 13.
    fn from_code(code: i32) -> Option<Self> {
        match code {
            0 => Some(Self::Off),
            1 => Some(Self::On),
            2 => Some(Self::NeedsApproval),
            _ => None,
        }
    }
}

/// Whether Compose opens at login; `None` where it cannot.
#[tauri::command]
pub fn login_item_status() -> Option<LoginItem> {
    native::status().and_then(LoginItem::from_code)
}

#[tauri::command]
pub fn login_item_set(enabled: bool) -> Result<Option<LoginItem>, String> {
    native::set(enabled)?;
    Ok(login_item_status())
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
        fn compose_login_item_status() -> i32;
        fn compose_login_item_set(enabled: bool) -> *mut c_char;
        fn compose_login_item_settings();
        fn compose_launched_at_login() -> bool;
    }

    // SAFETY, for each call: Swift functions from `native/LoginItem.swift` that
    // take and return plain values.
    pub(super) fn status() -> Option<i32> {
        Some(unsafe { compose_login_item_status() })
    }

    pub(super) fn set(enabled: bool) -> Result<(), String> {
        let failure = unsafe { compose_login_item_set(enabled) };
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
    pub(super) fn status() -> Option<i32> {
        None
    }

    pub(super) fn set(_enabled: bool) -> Result<(), String> {
        Err("Opening at login is not available in this build.".to_owned())
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
    fn the_state_crosses_to_the_front_end_in_camel_case() {
        assert_eq!(serde_json::to_string(&LoginItem::NeedsApproval).expect("json"), "\"needsApproval\"");
    }
}
