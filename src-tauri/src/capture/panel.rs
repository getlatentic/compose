//! Quick capture as a non-activating panel, the kind of window Spotlight uses.
//! It is the only kind macOS shows over another app's full-screen Space, and it
//! takes the keyboard without making Compose the active app: the app the user
//! was in stays in front, and has the keyboard back the moment the panel goes.
//!
//! Tauri builds every window as a `TaoWindow`, so the capture window becomes a
//! panel by changing its class. That is sound only while both classes lay out
//! an instance the same way — `NSPanel` adds nothing to `NSWindow`, and the
//! panel class carries tao's one instance variable — so the layout is checked
//! first, and a window that fails the check stays an ordinary one.

use std::ffi::CStr;
use std::sync::OnceLock;

use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, NSObjectProtocol};
use objc2::{msg_send, sel, ClassType};
use objc2_app_kit::{NSPanel, NSWindow, NSWindowStyleMask};

/// Where tao keeps whether a window may take the keyboard; tao finds it by name.
const TAO_FOCUSABLE: &CStr = c"focusable";

/// Turn `window` into a non-activating panel. `false` when that cannot be done
/// safely, and the window is left as it was.
pub(super) fn make_panel(window: &NSWindow) -> bool {
    let panel = panel_class();
    let object: &AnyObject = window.as_ref();
    if !same_layout(object.class(), panel) {
        return false;
    }
    // SAFETY: `same_layout` found one instance size and tao's variable at one
    // offset with one type, so every byte keeps its meaning. The only methods
    // lost are TaoWindow's overrides: `sendEvent:`, which serves windows movable
    // by their background (this one is not), and the key/main checks, which
    // NSPanel answers itself — key when titled, never main.
    unsafe { AnyObject::set_class(object, panel) };
    window.setStyleMask(window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
    stop_clicks_activating(window);
    true
}

/// AppKit marks a panel's clicks as leaving the active app alone when it creates
/// the panel with the non-activating style; adding the style to a window that
/// exists, as here, does not. So the mark is set directly. Without it the panel
/// still opens over full-screen apps and takes typing, but a click in it makes
/// Compose the active app.
fn stop_clicks_activating(window: &NSWindow) {
    let prevents_activation = sel!(_setPreventsActivation:);
    if window.respondsToSelector(prevents_activation) {
        // SAFETY: AppKit's NSWindow implements it as `- (void)_setPreventsActivation:(BOOL)`
        // (type encoding `v@:B`); present, as checked above.
        unsafe {
            let _: () = msg_send![window, _setPreventsActivation: true];
        }
    }
}

fn same_layout(window_class: &AnyClass, panel_class: &AnyClass) -> bool {
    let focusable = |class: &AnyClass| {
        class
            .instance_variable(TAO_FOCUSABLE)
            .map(|ivar| (ivar.offset(), ivar.type_encoding().to_owned()))
    };
    window_class.instance_size() == panel_class.instance_size()
        && focusable(window_class).is_some()
        && focusable(window_class) == focusable(panel_class)
}

fn panel_class() -> &'static AnyClass {
    static CLASS: OnceLock<&'static AnyClass> = OnceLock::new();
    CLASS.get_or_init(|| {
        let mut builder = ClassBuilder::new(c"ComposeCapturePanel", NSPanel::class())
            .expect("the capture panel class is registered once");
        builder.add_ivar::<Bool>(TAO_FOCUSABLE);
        builder.register()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A class laid out the way tao declares `TaoWindow`.
    fn window_class_with(name: &CStr, extra: Option<&CStr>, focusable: bool) -> &'static AnyClass {
        let mut builder = ClassBuilder::new(name, NSWindow::class()).expect("unique test class");
        if focusable {
            builder.add_ivar::<Bool>(TAO_FOCUSABLE);
        }
        if let Some(extra) = extra {
            builder.add_ivar::<u64>(extra);
        }
        builder.register()
    }

    /// Gone in some future macOS, clicks in quick capture activate Compose again.
    #[test]
    fn appkit_can_still_stop_a_window_activating_its_app() {
        let method = NSWindow::class()
            .instance_method(sel!(_setPreventsActivation:))
            .expect("NSWindow implements _setPreventsActivation:");
        assert_eq!(method.name(), sel!(_setPreventsActivation:));
        assert_eq!(method.arguments_count(), 3, "self, _cmd and one BOOL");
    }

    #[test]
    fn nspanel_adds_nothing_to_an_nswindow() {
        assert_eq!(NSPanel::class().instance_size(), NSWindow::class().instance_size());
    }

    #[test]
    fn a_tao_window_and_the_capture_panel_share_one_layout() {
        let tao_window = window_class_with(c"LayoutTestTaoWindow", None, true);
        assert!(same_layout(tao_window, panel_class()));
    }

    #[test]
    fn a_window_laid_out_differently_is_refused() {
        let without_tao_variable = window_class_with(c"LayoutTestPlainWindow", None, false);
        let larger = window_class_with(c"LayoutTestLargerWindow", Some(c"extra"), true);
        assert!(!same_layout(without_tao_variable, panel_class()));
        assert!(!same_layout(larger, panel_class()));
    }
}
