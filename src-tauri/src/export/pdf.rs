//! HTML → PDF via macOS WebKit.
//!
//! Renders a self-contained HTML document (from [`super::html`]) in an
//! offscreen `WKWebView` and uses WebKit's native `createPDFWithConfiguration:`
//! to produce a PDF. This gives the export the same rendering fidelity as a
//! browser — full CSS — with **no bundled engine** and no external process.
//!
//! ## Threading
//!
//! `WKWebView` is main-thread-only, so all WebKit work runs inside
//! `AppHandle::run_on_main_thread` closures and the live web views live in a
//! main-thread-local map keyed by job id. The worker thread (the async Tauri
//! command) only ever sends/receives `Send` values (`u64` ids, the final PDF
//! `Vec<u8>`), never the web view itself.
//!
//! ## Readiness
//!
//! The export HTML inlines its images as `data:` URIs and escapes raw HTML
//! (no scripts), so a load completes quickly with no network or JS. We poll
//! `isLoading` from the main thread (cheap) and call `createPDF` once it
//! settles, rather than installing a navigation-delegate class.
//!
//! ## Verification
//!
//! This path only runs inside the packaged macOS app (it needs a live AppKit
//! main thread). `cargo check`/`cargo test` validate the types and the
//! `super::html` renderer, but the actual PDF output must be confirmed by
//! driving the `.app` (see review-guide.md's "verify in the packaged app").

use tauri::AppHandle;

#[cfg(not(target_os = "macos"))]
pub fn html_to_pdf(_app: &AppHandle, _html: &str) -> Result<Vec<u8>, String> {
    Err("PDF export is only supported on macOS in this build.".to_string())
}

#[cfg(target_os = "macos")]
pub use imp::html_to_pdf;

#[cfg(target_os = "macos")]
mod imp {
    use super::AppHandle;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{NSData, NSError, NSString};
    use objc2_web_kit::{WKWebView, WKWebViewConfiguration};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
    use std::time::{Duration, Instant};

    /// A US-Letter-ish offscreen canvas (96dpi). The PDF is paginated by the
    /// print stylesheet's `@page`, so this is only the layout width.
    const PAGE_WIDTH: f64 = 816.0;
    const PAGE_HEIGHT: f64 = 1056.0;
    const OVERALL_TIMEOUT: Duration = Duration::from_secs(25);
    const POLL_INTERVAL: Duration = Duration::from_millis(80);

    struct Job {
        webview: Retained<WKWebView>,
        started: bool,
    }

    thread_local! {
        /// Live export web views, by job id. Main-thread-only (the values are
        /// `!Send`); every accessor below runs inside `run_on_main_thread`.
        static JOBS: RefCell<HashMap<u64, Job>> = RefCell::new(HashMap::new());
    }

    fn next_job_id() -> u64 {
        static COUNTER: AtomicU64 = AtomicU64::new(1);
        COUNTER.fetch_add(1, Ordering::Relaxed)
    }

    pub fn html_to_pdf(app: &AppHandle, html: &str) -> Result<Vec<u8>, String> {
        let (tx, rx) = channel::<Result<Vec<u8>, String>>();
        let job_id = next_job_id();

        // 1) Create the offscreen web view and start the load (main thread).
        let html_owned = html.to_string();
        let tx_err = tx.clone();
        app.run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else {
                let _ = tx_err.send(Err("PDF export not on the main thread".into()));
                return;
            };
            unsafe {
                let config = WKWebViewConfiguration::new(mtm);
                let frame = CGRect {
                    origin: CGPoint { x: 0.0, y: 0.0 },
                    size: CGSize {
                        width: PAGE_WIDTH,
                        height: PAGE_HEIGHT,
                    },
                };
                let webview =
                    WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), frame, &config);
                let html_ns = NSString::from_str(&html_owned);
                webview.loadHTMLString_baseURL(&html_ns, None);
                JOBS.with(|jobs| {
                    jobs.borrow_mut().insert(
                        job_id,
                        Job {
                            webview,
                            started: false,
                        },
                    );
                });
            }
        })
        .map_err(|error| format!("failed to start PDF render: {error}"))?;

        // 2) Wait for the finished PDF, polling readiness on the main thread
        //    until the completion handler delivers bytes (or we time out).
        let deadline = Instant::now() + OVERALL_TIMEOUT;
        loop {
            match rx.recv_timeout(POLL_INTERVAL) {
                Ok(result) => return result,
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("PDF render channel closed".into());
                }
                Err(RecvTimeoutError::Timeout) => {
                    if Instant::now() >= deadline {
                        cleanup(app, job_id);
                        return Err("PDF render timed out".into());
                    }
                    schedule_readiness_check(app, job_id, tx.clone());
                }
            }
        }
    }

    /// Schedule a main-thread check that starts the PDF once the page settles.
    /// Idempotent per job (`started` guard), so repeated polls are harmless.
    fn schedule_readiness_check(app: &AppHandle, job_id: u64, tx: Sender<Result<Vec<u8>, String>>) {
        let _ = app.run_on_main_thread(move || {
            JOBS.with(|jobs| {
                let mut map = jobs.borrow_mut();
                if let Some(job) = map.get_mut(&job_id) {
                    let loading = unsafe { job.webview.isLoading() };
                    if !job.started && !loading {
                        job.started = true;
                        start_pdf(job_id, &job.webview, tx);
                    }
                }
            });
        });
    }

    /// Kick off `createPDFWithConfiguration:` with a completion handler that
    /// forwards the bytes and retires the job (releasing the web view).
    fn start_pdf(job_id: u64, webview: &WKWebView, tx: Sender<Result<Vec<u8>, String>>) {
        let handler = RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
            let result = if !data.is_null() {
                Ok(unsafe { &*data }.to_vec())
            } else if !error.is_null() {
                let message = unsafe { &*error }.localizedDescription();
                Err(format!("WebKit PDF generation failed: {message}"))
            } else {
                Err("WebKit returned no PDF data".to_string())
            };
            let _ = tx.send(result);
            JOBS.with(|jobs| {
                jobs.borrow_mut().remove(&job_id);
            });
        });
        unsafe {
            webview.createPDFWithConfiguration_completionHandler(None, &handler);
        }
    }

    /// Drop a job's web view (timeout / abandonment), on the main thread.
    fn cleanup(app: &AppHandle, job_id: u64) {
        let _ = app.run_on_main_thread(move || {
            JOBS.with(|jobs| {
                jobs.borrow_mut().remove(&job_id);
            });
        });
    }
}
