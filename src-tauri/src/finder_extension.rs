//! Compose in the Finder: whether the user has turned the extension on, and the
//! System Settings pane where they do. Only the app that carries the extension
//! can ask.

#[cfg(target_os = "macos")]
mod mac {
    use objc2::runtime::{AnyClass, Bool};
    use objc2::{available, msg_send};
    use objc2_foundation::NSBundle;

    const EXTENSION: &str = "ComposeFinder.appex";

    #[link(name = "FinderSync", kind = "framework")]
    extern "C" {}

    fn controller() -> Option<&'static AnyClass> {
        AnyClass::get(c"FIFinderSyncController")
    }

    /// A development build carries no extension to turn on.
    fn carried() -> bool {
        NSBundle::mainBundle()
            .builtInPlugInsPath()
            .is_some_and(|plugins| std::path::Path::new(&plugins.to_string()).join(EXTENSION).exists())
    }

    pub(super) fn enabled() -> Option<bool> {
        if !carried() || !available!(macos = 10.14) {
            return None;
        }
        // SAFETY: a class property of FIFinderSyncController, macOS 10.14 and later.
        controller().map(|class| unsafe { msg_send![class, isExtensionEnabled] }).map(Bool::as_bool)
    }

    pub(super) fn show_settings() {
        if let Some(class) = controller().filter(|_| available!(macos = 10.14)) {
            // SAFETY: a class method of FIFinderSyncController, macOS 10.14 and later.
            unsafe {
                let _: () = msg_send![class, showExtensionManagementInterface];
            }
        }
    }
}

/// Whether the Finder extension is on, or `None` when this copy has none.
#[tauri::command]
pub fn finder_extension_enabled() -> Option<bool> {
    #[cfg(target_os = "macos")]
    return mac::enabled();
    #[cfg(not(target_os = "macos"))]
    None
}

/// Open the System Settings pane where the user turns the Finder extension on.
#[tauri::command]
pub fn finder_extension_settings() {
    #[cfg(target_os = "macos")]
    mac::show_settings();
}
