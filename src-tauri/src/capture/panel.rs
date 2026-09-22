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

use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, NSObjectProtocol, Sel};
use objc2::{msg_send, sel, ClassType, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSEvent, NSEventModifierFlags, NSPanel, NSWindow, NSWindowStyleMask};

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
        // SAFETY: the function matches `- (BOOL)performKeyEquivalent:(NSEvent *)event`.
        unsafe {
            builder.add_method(
                sel!(performKeyEquivalent:),
                perform_key_equivalent as unsafe extern "C-unwind" fn(*mut AnyObject, Sel, *mut NSEvent) -> Bool,
            );
        }
        builder.register()
    })
}

/// The panel's own editing shortcuts. They are the menu bar's, and while the
/// panel is over another app the menu bar is that app's: without this, ⌘V would
/// paste nothing. Cut, copy and paste go straight to the page as the menu's
/// actions would; select-all and undo reach the page's editor first, which
/// keeps its own undo history, and act natively only when it leaves them.
unsafe extern "C-unwind" fn perform_key_equivalent(this: *mut AnyObject, _cmd: Sel, event: *mut NSEvent) -> Bool {
    // SAFETY: AppKit calls this with the panel and a live key event.
    let (this, event) = unsafe { (&*this, &*event) };
    let shortcut = editing_shortcut(event);
    if let Some((action, true)) = shortcut {
        if send_action(this, action) {
            return Bool::YES;
        }
    }
    // SAFETY: NSPanel implements it, with the same signature.
    let handled: Bool = unsafe { msg_send![super(this, NSPanel::class()), performKeyEquivalent: event] };
    match shortcut {
        Some((action, false)) if !handled.as_bool() => Bool::new(send_action(this, action)),
        _ => handled,
    }
}

fn editing_shortcut(event: &NSEvent) -> Option<(Sel, bool)> {
    editing_action(event.modifierFlags(), &event.charactersIgnoringModifiers()?.to_string())
}

/// The editing action a key equivalent names, and whether it goes to the page
/// directly (`true`) or only when the page does not take the key itself.
fn editing_action(flags: NSEventModifierFlags, key: &str) -> Option<(Sel, bool)> {
    let flags = flags & NSEventModifierFlags::DeviceIndependentFlagsMask;
    let shifted = flags.contains(NSEventModifierFlags::Shift);
    if !flags.contains(NSEventModifierFlags::Command) || flags.intersects(NSEventModifierFlags::Control | NSEventModifierFlags::Option) {
        return None;
    }
    match (key.to_lowercase().as_str(), shifted) {
        ("x", false) => Some((sel!(cut:), true)),
        ("c", false) => Some((sel!(copy:), true)),
        ("v", false) => Some((sel!(paste:), true)),
        ("a", false) => Some((sel!(selectAll:), false)),
        ("z", false) => Some((sel!(undo:), false)),
        ("z", true) => Some((sel!(redo:), false)),
        _ => None,
    }
}

fn send_action(sender: &AnyObject, action: Sel) -> bool {
    let Some(mtm) = MainThreadMarker::new() else { return false };
    // SAFETY: a nil target sends `action` along the responder chain from the key
    // window's first responder, as a menu item does; AppKit calls this method
    // on the main thread.
    unsafe { NSApplication::sharedApplication(mtm).sendAction_to_from(action, None, Some(sender)) }
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
    fn cut_copy_and_paste_go_straight_to_the_page() {
        let command = NSEventModifierFlags::Command;
        assert_eq!(editing_action(command, "v"), Some((sel!(paste:), true)));
        assert_eq!(editing_action(command, "c"), Some((sel!(copy:), true)));
        assert_eq!(editing_action(command, "x"), Some((sel!(cut:), true)));
    }

    #[test]
    fn select_all_and_undo_are_the_editors_first() {
        let command = NSEventModifierFlags::Command;
        assert_eq!(editing_action(command, "a"), Some((sel!(selectAll:), false)));
        assert_eq!(editing_action(command, "z"), Some((sel!(undo:), false)));
        assert_eq!(editing_action(command | NSEventModifierFlags::Shift, "Z"), Some((sel!(redo:), false)));
    }

    #[test]
    fn other_shortcuts_are_left_alone() {
        assert_eq!(editing_action(NSEventModifierFlags::Command, "b"), None, "the editor's bold");
        assert_eq!(editing_action(NSEventModifierFlags::Command | NSEventModifierFlags::Control, "v"), None);
        assert_eq!(editing_action(NSEventModifierFlags::Command | NSEventModifierFlags::Option, "v"), None);
        assert_eq!(editing_action(NSEventModifierFlags::empty(), "v"), None, "typing a v");
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
