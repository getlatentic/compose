//! An HTML page drawn in a `WKWebView` that is never shown: the surface both
//! the paged output ([`super::paged`], PDF and Print) and the image cards
//! ([`super::snapshot`]) render through.
//!
//! The web view lives in a borderless window far offscreen, which gives it the
//! live view hierarchy WebKit needs to draw. `WKWebView` and `NSWindow` are
//! main-thread-only, so every touch of a page happens inside
//! `run_on_main_thread`; the export command's worker thread opens a page, waits
//! for it to be ready, asks for work on it, and closes it, each by id.

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::MainThreadMarker;
use objc2::MainThreadOnly;
use objc2_app_kit::{NSBackingStoreType, NSWindow, NSWindowStyleMask};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_foundation::{NSError, NSString};
use objc2_web_kit::{WKWebView, WKWebViewConfiguration};
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::channel;
use std::time::{Duration, Instant};
use tauri::AppHandle;

use block2::RcBlock;

/// Far enough offscreen that the host window never flickers into view.
const OFFSCREEN_ORIGIN: f64 = -100_000.0;
const POLL_INTERVAL: Duration = Duration::from_millis(80);
/// How long one question to the main thread may take before the page counts
/// as not ready yet.
const MAIN_THREAD_REPLY: Duration = Duration::from_secs(2);

/// A page and the window it draws in. Both are released when it is closed.
#[derive(Clone)]
pub struct Page {
    pub webview: Retained<WKWebView>,
    pub window: Retained<NSWindow>,
}

thread_local! {
    /// Open pages, by id; main-thread-only, like the views they hold.
    static PAGES: RefCell<HashMap<u64, Page>> = RefCell::new(HashMap::new());
}

/// When a page counts as ready for its work.
#[derive(Clone, Copy)]
pub enum Readiness {
    /// The HTML has finished loading.
    Loaded,
    /// The page has loaded and has set `data-ready` on its root element.
    MarkedReady,
}

pub fn rect(x: f64, y: f64, size: CGSize) -> CGRect {
    CGRect { origin: CGPoint { x, y }, size }
}

fn next_id() -> u64 {
    static COUNTER: AtomicU64 = AtomicU64::new(1);
    COUNTER.fetch_add(1, Ordering::Relaxed)
}

/// Start drawing `html` in a page `size` points large; returns its id once
/// the page exists. Blocks the calling (worker) thread.
pub fn open(app: &AppHandle, html: String, size: CGSize) -> Result<u64, String> {
    let id = next_id();
    let (tx, rx) = channel();
    app.run_on_main_thread(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            let _ = tx.send(Err("the page was not opened on the main thread".to_owned()));
            return;
        };
        PAGES.with(|pages| pages.borrow_mut().insert(id, new_page(mtm, &html, size)));
        let _ = tx.send(Ok(id));
    })
    .map_err(|error| format!("could not open the page: {error}"))?;
    rx.recv_timeout(MAIN_THREAD_REPLY).map_err(|_| "the page did not open in time".to_owned())?
}

fn new_page(mtm: MainThreadMarker, html: &str, size: CGSize) -> Page {
    let webview = unsafe {
        let configuration = WKWebViewConfiguration::new(mtm);
        WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), rect(0.0, 0.0, size), &configuration)
    };
    let window = unsafe {
        NSWindow::initWithContentRect_styleMask_backing_defer(
            NSWindow::alloc(mtm),
            rect(OFFSCREEN_ORIGIN, OFFSCREEN_ORIGIN, size),
            NSWindowStyleMask::Borderless,
            NSBackingStoreType::Buffered,
            false,
        )
    };
    window.setContentView(Some(webview.as_ref()));
    unsafe { webview.loadHTMLString_baseURL(&NSString::from_str(html), None) };
    Page { webview, window }
}

/// Wait until the page is `readiness` ready, or fail at `deadline` (the page
/// stays open; the caller closes it).
pub fn wait_until_ready(app: &AppHandle, id: u64, readiness: Readiness, deadline: Instant) -> Result<(), String> {
    loop {
        if is_ready(app, id, readiness) {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err("the page took too long to draw".to_owned());
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

fn is_ready(app: &AppHandle, id: u64, readiness: Readiness) -> bool {
    let (tx, rx) = channel();
    let asked = app.run_on_main_thread(move || {
        let webview = PAGES.with(|pages| pages.borrow().get(&id).map(|page| Retained::clone(&page.webview)));
        let Some(webview) = webview.filter(|webview| !unsafe { webview.isLoading() }) else {
            let _ = tx.send(false);
            return;
        };
        match readiness {
            Readiness::Loaded => {
                let _ = tx.send(true);
            }
            Readiness::MarkedReady => ask_marked_ready(&webview, tx),
        }
    });
    asked.is_ok() && rx.recv_timeout(MAIN_THREAD_REPLY).unwrap_or(false)
}

fn ask_marked_ready(webview: &WKWebView, tx: std::sync::mpsc::Sender<bool>) {
    let script = NSString::from_str("document.documentElement.dataset.ready || ''");
    let handler = RcBlock::new(move |value: *mut AnyObject, _error: *mut NSError| {
        let marked = unsafe { value.as_ref() }
            .and_then(|value| value.downcast_ref::<NSString>())
            .is_some_and(|value| value.to_string() == "1");
        let _ = tx.send(marked);
    });
    unsafe { webview.evaluateJavaScript_completionHandler(&script, Some(&handler)) };
}

/// Run `work` on the main thread with the open page, or with `None` when it
/// has been closed.
pub fn with_page(
    app: &AppHandle,
    id: u64,
    work: impl FnOnce(MainThreadMarker, Option<&Page>) + Send + 'static,
) -> Result<(), String> {
    app.run_on_main_thread(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        // A copy, so `work` may close the page without a borrow held.
        let page = PAGES.with(|pages| pages.borrow().get(&id).cloned());
        work(mtm, page.as_ref());
    })
    .map_err(|error| format!("could not reach the page: {error}"))
}

/// Release the page and its window. Call from any thread.
pub fn close(app: &AppHandle, id: u64) {
    if app.run_on_main_thread(move || close_on_main_thread(id)).is_err() {
        eprintln!("offscreen page {id} could not be closed: the main thread is gone");
    }
}

/// [`close`], for code already on the main thread.
pub fn close_on_main_thread(id: u64) {
    PAGES.with(|pages| pages.borrow_mut().remove(&id));
}
