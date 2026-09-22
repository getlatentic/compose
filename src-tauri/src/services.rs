//! The macOS Services menu: turn a selection in any app into a note.
//!
//! A Service is declared in `Info.plist` (`NSServices`) but delivered to an
//! Objective-C object registered with `NSApp`, so both halves have to agree:
//! `NSMessage` names the selector implemented below.
//!
//! Unlike a `compose://` link, a Service carries no path — the user ran it on
//! their own selection, in an app they were already using — so there is
//! nothing here to authorise.

use std::sync::Mutex;

/// Selections captured before the frontend could listen — a Service can be the
/// thing that launches the app. Drained once the UI mounts, exactly as
/// [`crate::open_with::PendingOpenUrls`] is for files.
#[derive(Default)]
pub struct PendingServiceText(Mutex<Vec<String>>);

impl PendingServiceText {
    #[cfg(target_os = "macos")]
    fn push(&self, text: String) {
        if let Ok(mut queue) = self.0.lock() {
            queue.push(text);
        }
    }

    fn drain(&self) -> Vec<String> {
        self.0
            .lock()
            .map(|mut queue| std::mem::take(&mut *queue))
            .unwrap_or_default()
    }
}

#[tauri::command]
pub fn drain_pending_service_text(pending: tauri::State<'_, PendingServiceText>) -> Vec<String> {
    pending.drain()
}

/// The Services menu is a macOS concept; elsewhere there is nothing to offer
/// and nothing ever reaches [`PendingServiceText`].
#[cfg(not(target_os = "macos"))]
pub fn register(_app: &tauri::AppHandle) {}

#[cfg(target_os = "macos")]
pub use mac::register;

#[cfg(target_os = "macos")]
mod mac {
    use objc2::rc::Retained;
    use objc2::{define_class, msg_send, DeclaredClass, MainThreadOnly};
    use objc2_app_kit::{NSApplication, NSPasteboard, NSPasteboardTypeString};
    use objc2_foundation::{MainThreadMarker, NSObject, NSString};
    use tauri::{AppHandle, Emitter, Manager};

    use super::PendingServiceText;

    pub const NEW_NOTE_EVENT: &str = "compose:new-note-from-selection";

    /// Buffer the selection, tell a listening frontend to drain it, and bring
    /// the window up — a Service fires while another app is frontmost, and the
    /// note is only useful if the user can see it being written.
    fn capture(app: &AppHandle, text: String) {
        if text.trim().is_empty() {
            return;
        }
        app.state::<PendingServiceText>().push(text);
        let _ = app.emit(NEW_NOTE_EVENT, ());
        crate::main_window::ensure(app);
    }

    struct ProviderIvars {
        app: AppHandle,
    }

    define_class!(
        /// The object `NSApp` hands a Service invocation to.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "ComposeServiceProvider"]
        #[ivars = ProviderIvars]
        struct ServiceProvider;

        impl ServiceProvider {
            #[unsafe(method(newNoteFromSelection:userData:error:))]
            fn new_note_from_selection(
                &self,
                pasteboard: &NSPasteboard,
                _user_data: *mut NSString,
                _error: *mut *mut NSString,
            ) {
                let text = unsafe { pasteboard.stringForType(NSPasteboardTypeString) };
                if let Some(text) = text {
                    capture(&self.ivars().app, text.to_string());
                }
            }
        }
    );

    impl ServiceProvider {
        fn new(mtm: MainThreadMarker, app: AppHandle) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(ProviderIvars { app });
            unsafe { msg_send![super(this), init] }
        }
    }

    /// Offer the app's Services to the rest of the system. Runs on the main
    /// thread, once `NSApp` exists.
    pub fn register(app: &AppHandle) {
        let app = app.clone();
        let _ = app.clone().run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let provider = ServiceProvider::new(mtm, app.clone());
            let ns_app = NSApplication::sharedApplication(mtm);
            unsafe { ns_app.setServicesProvider(Some(&provider)) };
            // `setServicesProvider:` does not keep the provider alive, and a
            // Service can fire at any point in the app's life.
            std::mem::forget(provider);
            // The menu is cached per app; without this the item only appears
            // after the next login or `lsregister` sweep.
            objc2_app_kit::NSUpdateDynamicServices();
        });
    }
}
