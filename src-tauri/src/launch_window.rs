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

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager};

/// How long the window stays hidden waiting to be told the app is drawn. Long
/// enough to cover a warm launch with room to spare, short enough that a launch
/// which is going badly still puts something on screen promptly.
const READY_DEADLINE: Duration = Duration::from_millis(900);

static LAUNCHES: Launches = Launches::new();

/// Each main window is one launch: it is shown once, by whichever of its own
/// drawing or its deadline comes first. A later window — the user closed the
/// first and came back — is a new launch that an old deadline cannot show.
struct Launches {
    current: AtomicU64,
    shown: AtomicU64,
}

impl Launches {
    const fn new() -> Self {
        Self { current: AtomicU64::new(0), shown: AtomicU64::new(0) }
    }

    fn begin(&self) -> u64 {
        self.current.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn current(&self) -> u64 {
        self.current.load(Ordering::SeqCst)
    }

    /// Whether `launch` should show its window now: it is the latest, and not shown yet.
    fn claim(&self, launch: u64) -> bool {
        launch != 0 && launch == self.current() && self.shown.swap(launch, Ordering::SeqCst) != launch
    }

    fn is_shown(&self) -> bool {
        let current = self.current();
        current != 0 && self.shown.load(Ordering::SeqCst) == current
    }
}

/// Show the main window once per launch, whoever asks first. `set_focus` is what
/// makes the web view start running in the first place when the window was
/// created behind another app, so it stays paired with the show.
fn show_once(app: &AppHandle, launch: u64, reason: &str) {
    if !LAUNCHES.claim(launch) {
        return;
    }
    let Some(window) = app.get_webview_window(crate::main_window::LABEL) else {
        return;
    };
    crate::boot_native_mark(reason);
    let _ = window.show();
    let _ = window.set_focus();
}

/// The app has drawn a complete first screen.
#[tauri::command]
pub fn launch_window_ready(app: AppHandle) {
    show_once(&app, LAUNCHES.current(), "window-shown-by-live-app");
}

/// The web view has begun parsing the document. Nothing waits on this; it marks
/// the moment the web view actually started, which is otherwise invisible from
/// the Rust side of the launch.
#[tauri::command]
pub fn launch_document_parsed() {
    crate::boot_native_mark("document-parsing");
}

/// A main window was just made: start the deadline its front end is racing.
pub fn arm_deadline(app: AppHandle) {
    let launch = LAUNCHES.begin();
    std::thread::spawn(move || {
        std::thread::sleep(READY_DEADLINE);
        show_once(&app, launch, "window-shown-by-deadline");
    });
}

/// Whether the main window has been shown since it was made; until then its
/// launch shows it.
pub fn shown() -> bool {
    LAUNCHES.is_shown()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_launch_is_shown_once_by_whichever_asks_first() {
        let launches = Launches::new();
        assert!(!launches.is_shown());
        let first = launches.begin();
        assert!(launches.claim(first));
        assert!(!launches.claim(first), "the deadline after the drawing does nothing");
        assert!(launches.is_shown());
    }

    #[test]
    fn a_new_window_is_a_new_launch_an_old_deadline_cannot_show() {
        let launches = Launches::new();
        let first = launches.begin();
        assert!(launches.claim(first));
        let second = launches.begin();
        assert!(!launches.is_shown(), "the new window waits for its own drawing");
        assert!(!launches.claim(first));
        assert!(launches.claim(second));
    }

    #[test]
    fn nothing_is_shown_before_any_launch() {
        let launches = Launches::new();
        assert!(!launches.claim(launches.current()));
    }
}
