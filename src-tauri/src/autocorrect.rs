//! Compose leaves what is typed as it was typed: macOS's automatic spelling
//! correction is off in every Compose web view — notes, chat and quick capture.
//! Misspellings are still underlined.
//!
//! WebKit reads the choice from the app's own defaults before it falls back to
//! the system-wide setting, so a registered default is enough; it is never
//! written to the user's preferences.

/// Run before the first web view is made: WebKit reads the setting once.
#[cfg(target_os = "macos")]
pub fn turn_off() {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{ns_string, NSDictionary, NSNumber, NSString, NSUserDefaults};

    let off = NSNumber::new_bool(false);
    let defaults = NSDictionary::<NSString, AnyObject>::from_slices(
        &[ns_string!("WebAutomaticSpellingCorrectionEnabled")],
        &[off.as_ref()],
    );
    // SAFETY: the dictionary holds only property-list values, as
    // `registerDefaults:` requires.
    unsafe { NSUserDefaults::standardUserDefaults().registerDefaults(&defaults) };
}

#[cfg(not(target_os = "macos"))]
pub fn turn_off() {}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use objc2_foundation::{ns_string, NSUserDefaults};

    #[test]
    fn web_views_are_told_not_to_correct_spelling() {
        super::turn_off();
        let defaults = NSUserDefaults::standardUserDefaults();
        let key = ns_string!("WebAutomaticSpellingCorrectionEnabled");
        assert!(defaults.objectForKey(key).is_some(), "the default is registered");
        assert!(!defaults.boolForKey(key));
    }
}
