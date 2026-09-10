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

/// There is something worth looking at. `reason` says what — the replayed
/// screen going up, or the live app finishing — because which of the two wins
/// the race is the whole question.
#[tauri::command]
pub fn launch_window_ready(app: AppHandle, reason: Option<String>) {
    let label = match reason.as_deref() {
        Some("shell") => "window-shown-by-replayed-screen",
        _ => "window-shown-by-live-app",
    };
    show_once(&app, label);
}

/// Start the deadline the front end is racing.
pub fn arm_deadline(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(READY_DEADLINE);
        show_once(&app, "window-shown-by-deadline");
    });
}
