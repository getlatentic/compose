//! The capture window: made once and kept hidden, opened by the shortcut on the
//! screen the pointer is on, and hidden again when the user saves or leaves.
//! On macOS it is a panel that takes the keyboard without taking the user out
//! of the app they were in.

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use super::shortcut::View;

pub(super) const LABEL: &str = "capture";
/// Tells the page it is on screen again, and which part to show, so it takes the keyboard.
const SHOWN_EVENT: &str = "capture:shown";
const WIDTH: f64 = 680.0;
const HEIGHT: f64 = 420.0;
const MIN_WIDTH: f64 = 480.0;
const MIN_HEIGHT: f64 = 280.0;

/// The part of the window last shown.
static SHOWING: Mutex<View> = Mutex::new(View::Notes);

#[derive(Clone, Serialize)]
struct Shown {
    view: View,
}

/// The capture window, built hidden if it does not exist yet, so a press of the
/// shortcut only has to show it.
pub(crate) fn prepare(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return Ok(window);
    }
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("capture.html".into()))
        .title("Quick Note")
        .inner_size(WIDTH, HEIGHT)
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .resizable(true)
        .minimizable(false)
        .maximizable(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    let window = builder.build()?;
    platform::configure(&window);
    Ok(window)
}

/// What a shortcut does: close the window if the user is in that part of it,
/// switch to that part if they are in the other, and otherwise open it on that
/// part — or bring it back if it was left open behind something.
pub(super) fn toggle(app: &AppHandle, view: View) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || toggle_now(&handle, view)) {
        eprintln!("quick capture could not be scheduled: {error}");
    }
}

fn toggle_now(app: &AppHandle, view: View) {
    let in_use = app.get_webview_window(LABEL).is_some_and(|window| {
        window.is_visible().unwrap_or(false) && window.is_focused().unwrap_or(false)
    });
    let showing = SHOWING.lock().map(|showing| *showing).unwrap_or(View::Notes);
    let result = if in_use && showing == view {
        hide_and_return_focus(app);
        Ok(())
    } else if in_use {
        show_view(app, view)
    } else {
        open(app, view)
    };
    if let Err(error) = result {
        eprintln!("quick capture could not open: {error}");
    }
}

/// Open the window on `view`, or bring it back, leaving it open if it already is.
pub(super) fn show(app: &AppHandle, view: View) {
    let handle = app.clone();
    let scheduled = app.run_on_main_thread(move || {
        if let Err(error) = open(&handle, view) {
            eprintln!("quick capture could not open: {error}");
        }
    });
    if let Err(error) = scheduled {
        eprintln!("quick capture could not be scheduled: {error}");
    }
}

/// Hide the window and give the keyboard back to the app the user was in.
pub(super) fn close(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || hide_and_return_focus(&handle));
}

fn open(app: &AppHandle, view: View) -> tauri::Result<()> {
    let window = prepare(app)?;
    place_where_the_pointer_is(&window)?;
    window.show()?;
    platform::focus(&window);
    show_view(app, view)
}

fn show_view(app: &AppHandle, view: View) -> tauri::Result<()> {
    if let Ok(mut showing) = SHOWING.lock() {
        *showing = view;
    }
    app.emit_to(LABEL, SHOWN_EVENT, Shown { view })
}

fn hide_and_return_focus(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window.hide();
    }
    platform::return_focus();
}

/// Centred across the screen the pointer is on, a fifth of the way down — where
/// the user is looking, whichever display that is.
fn place_where_the_pointer_is(window: &WebviewWindow) -> tauri::Result<()> {
    let pointer = window.cursor_position()?;
    let Some(monitor) = window.monitor_from_point(pointer.x, pointer.y)? else {
        return window.center();
    };
    let area = monitor.work_area();
    // The size the user left it at, which may differ from the one it opened with.
    let width = window.outer_size().map(|size| size.width as i32).unwrap_or((WIDTH * monitor.scale_factor()).round() as i32);
    let x = area.position.x + (area.size.width as i32 - width) / 2;
    let y = area.position.y + area.size.height as i32 / 5;
    window.set_position(PhysicalPosition::new(x, y))
}

#[cfg(target_os = "macos")]
mod platform {
    use std::sync::Mutex;

    use objc2::runtime::NSObjectProtocol;
    use objc2::ClassType;
    use objc2_app_kit::{
        NSApplicationActivationOptions, NSPanel, NSRunningApplication, NSWindow, NSWindowButton,
        NSWindowCollectionBehavior, NSWorkspace,
    };
    use tauri::WebviewWindow;

    use crate::capture::panel;

    /// The app that was in front when an ordinary capture window made Compose
    /// active, which gets the keyboard back when it closes.
    static PREVIOUS_APP: Mutex<Option<i32>> = Mutex::new(None);

    pub(super) fn configure(window: &WebviewWindow) {
        let Some(ns_window) = ns_window(window) else { return };
        if !panel::make_panel(ns_window) {
            eprintln!("quick capture stays an ordinary window: its layout does not match a panel's");
        }
        // On whichever Space the user is in, full-screen apps' included.
        ns_window.setCollectionBehavior(
            ns_window.collectionBehavior()
                | NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary,
        );
        ns_window.setHidesOnDeactivate(false);
        // Esc closes it and ⌘↩ saves; window buttons would only be in the way.
        for button in [
            NSWindowButton::CloseButton,
            NSWindowButton::MiniaturizeButton,
            NSWindowButton::ZoomButton,
        ] {
            if let Some(button) = ns_window.standardWindowButton(button) {
                button.setHidden(true);
            }
        }
    }

    fn remember_frontmost_app() {
        let frontmost = NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .map(|app| app.processIdentifier());
        let own = std::process::id() as i32;
        if let Ok(mut previous) = PREVIOUS_APP.lock() {
            *previous = frontmost.filter(|pid| *pid != own);
        }
    }

    /// Key and in front. A panel takes the keyboard while the user's app stays
    /// active. An ordinary window needs Compose active — but not through NSApp's
    /// `activateIgnoringOtherApps`, which would bring every Compose window
    /// forward over what the user was doing.
    pub(super) fn focus(window: &WebviewWindow) {
        let Some(ns_window) = ns_window(window) else { return };
        ns_window.makeKeyAndOrderFront(None);
        if ns_window.isKindOfClass(NSPanel::class()) {
            return;
        }
        remember_frontmost_app();
        NSRunningApplication::currentApplication()
            .activateWithOptions(NSApplicationActivationOptions::empty());
    }

    pub(super) fn return_focus() {
        let previous = PREVIOUS_APP.lock().ok().and_then(|mut previous| previous.take());
        let Some(pid) = previous else { return };
        if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
            app.activateWithOptions(NSApplicationActivationOptions::empty());
        }
    }

    fn ns_window(window: &WebviewWindow) -> Option<&NSWindow> {
        let pointer = window.ns_window().ok()?.cast::<NSWindow>();
        // SAFETY: Tauri hands back the live NSWindow it owns for this window,
        // which outlives this borrow; AppKit calls here run on the main thread.
        unsafe { pointer.as_ref() }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use tauri::WebviewWindow;

    pub(super) fn configure(_window: &WebviewWindow) {}
    pub(super) fn focus(window: &WebviewWindow) {
        let _ = window.set_focus();
    }
    pub(super) fn return_focus() {}
}
