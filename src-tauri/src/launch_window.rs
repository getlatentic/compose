//! Show the window when the app inside it is finished drawing.
//!
//! A web view cannot paint its first frame until its bundle has loaded and
//! rendered, so a window that is visible from the start has to show *something*
//! in the meantime — which is what a skeleton is, and what a launch that
//! assembles itself in front of the reader is made of. A native app shows
//! nothing and then a finished window; this does the same.
//!
//! The deadline is the whole safety of it. The front end may be slow (a cold
//! vault), may fail, or may never run at all — a WKWebView whose window is
//! never visible is not guaranteed to execute the page's JavaScript. Past the
//! deadline the window is shown regardless, which is exactly the old behaviour:
//! the skeleton, and the app filling into it.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager};

/// How long the window stays hidden waiting to be told the app is drawn. Long
/// enough to cover a warm launch with room to spare, short enough that a launch
/// which is going badly still puts something on screen promptly.
const READY_DEADLINE: Duration = Duration::from_millis(900);

static SHOWN: AtomicBool = AtomicBool::new(false);

/// Show the main window once, whoever asks first. `set_focus` is what makes the
/// web view start running in the first place when the window was created behind
/// another app, so it stays paired with the show.
fn show_once(app: &AppHandle, reason: &str) {
    if SHOWN.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    crate::boot_native_mark(reason);
    let _ = window.show();
    let _ = window.set_focus();
}

/// The app has drawn a complete first screen.
#[tauri::command]
pub fn launch_window_ready(app: AppHandle) {
    show_once(&app, "window-shown-by-live-app");
}

/// The web view has begun parsing the document. Nothing waits on this; it marks
/// the moment the web view actually started, which is otherwise invisible from
/// the Rust side of the launch.
#[tauri::command]
pub fn launch_document_parsed() {
    crate::boot_native_mark("document-parsing");
}

/// Start the deadline the front end is racing.
pub fn arm_deadline(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(READY_DEADLINE);
        show_once(&app, "window-shown-by-deadline");
    });
}
