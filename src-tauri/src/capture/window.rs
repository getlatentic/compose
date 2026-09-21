//! The capture window: made once and kept hidden, opened by the shortcut on the
//! screen the pointer is on, and hidden again when the user saves or leaves,
//! handing focus back to the app they were in.

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub(super) const LABEL: &str = "capture";
/// Tells the page it is on screen again, so it takes the keyboard.
const SHOWN_EVENT: &str = "capture:shown";
const WIDTH: f64 = 520.0;
const HEIGHT: f64 = 240.0;

/// The capture window, built hidden if it does not exist yet, so a press of the
/// shortcut only has to show it.
pub(crate) fn prepare(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return Ok(window);
    }
    let builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("capture.html".into()))
        .title("Quick Note")
        .inner_size(WIDTH, HEIGHT)
        .resizable(false)
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

/// What the shortcut does: open capture, or close it if it is already open.
pub(super) fn toggle(app: &AppHandle) {
    let handle = app.clone();
    let scheduled = app.run_on_main_thread(move || {
        let open_now = handle
            .get_webview_window(LABEL)
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false);
        if open_now {
            hide_and_return_focus(&handle);
        } else if let Err(error) = open(&handle) {
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

fn open(app: &AppHandle) -> tauri::Result<()> {
    let window = prepare(app)?;
    platform::remember_frontmost_app();
    place_where_the_pointer_is(&window)?;
    window.show()?;
    platform::focus(&window);
    app.emit_to(LABEL, SHOWN_EVENT, ())
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
    let width = (WIDTH * monitor.scale_factor()).round() as i32;
    let x = area.position.x + (area.size.width as i32 - width) / 2;
    let y = area.position.y + area.size.height as i32 / 5;
    window.set_position(PhysicalPosition::new(x, y))
}

#[cfg(target_os = "macos")]
mod platform {
    use std::sync::Mutex;

    use objc2_app_kit::{
        NSApplicationActivationOptions, NSRunningApplication, NSWindow, NSWindowButton,
        NSWindowCollectionBehavior, NSWorkspace,
    };
    use tauri::WebviewWindow;

    /// The app that was in front when capture opened, which gets the keyboard
    /// back when it closes.
    static PREVIOUS_APP: Mutex<Option<i32>> = Mutex::new(None);

    pub(super) fn configure(window: &WebviewWindow) {
        let Some(ns_window) = ns_window(window) else { return };
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

    pub(super) fn remember_frontmost_app() {
        let frontmost = NSWorkspace::sharedWorkspace()
            .frontmostApplication()
            .map(|app| app.processIdentifier());
        let own = std::process::id() as i32;
        if let Ok(mut previous) = PREVIOUS_APP.lock() {
            *previous = frontmost.filter(|pid| *pid != own);
        }
    }

    /// Key and in front, with Compose active — but not NSApp's
    /// `activateIgnoringOtherApps`, which would bring every Compose window
    /// forward over what the user was doing. Only this one comes.
    pub(super) fn focus(window: &WebviewWindow) {
        let Some(ns_window) = ns_window(window) else { return };
        ns_window.makeKeyAndOrderFront(None);
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
    pub(super) fn remember_frontmost_app() {}
    pub(super) fn focus(window: &WebviewWindow) {
        let _ = window.set_focus();
    }
    pub(super) fn return_focus() {}
}
