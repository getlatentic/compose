//! Paginated native output for the export HTML: the shared WebKit + AppKit
//! engine behind both PDF export ([`super::pdf`]) and Print ([`super::print`]).
//!
//! Both surfaces need the *same* thing: render the export HTML (from
//! [`super::html`]) in an offscreen `WKWebView`, then run an `NSPrintOperation`
//! over it. They differ only in how that operation is configured and what counts
//! as success:
//!
//! - **PDF export** sets the operation's disposition to save-to-file (no panels)
//!   and the "success" payload is the written PDF.
//! - **Print** shows the system print panel and the payload is whether the user
//!   printed (vs cancelled).
//!
//! Routing *both* through one `NSPrintOperation` (rather than `createPDF` for the
//! PDF path) is what makes their page geometry agree: WebKit paginates the same
//! way for both, and per-page margins come from `NSPrintInfo` — identical top/
//! bottom/left/right on every page, with no empty trailing page. WebKit's
//! `createPDF` cannot paginate (it emits one tall page and ignores `@page`). The
//! print path relayouts to the page's imageable width (paper minus the
//! `NSPrintInfo` margins) and reflows text to fit, so [`PAGE_MARGIN`] is the
//! source of truth for margins; the `@page { margin }` in `html::PRINT_CSS` is
//! kept equal to it so the two never disagree.
//!
//! ## Why an offscreen window + the async run
//!
//! `WKWebView` renders out-of-process and delivers pages asynchronously. The
//! synchronous `NSPrintOperation::runOperation` returns *before* WebKit has drawn
//! into the print/PDF graphics context, so the output comes out blank. The fix is
//! twofold: host the web view in an (offscreen, never-shown) `NSWindow` so it has
//! a live view hierarchy to render through, and drive the operation with
//! `runOperationModalForWindow:` — the asynchronous path modern WebKit needs to
//! finish drawing. The operation's view frame must be sized to the paper or the
//! run crashes.
//!
//! ## Threading
//!
//! `WKWebView`, `NSWindow`, and `NSPrintOperation` are main-thread-only, so the
//! load and the run happen inside `AppHandle::run_on_main_thread`. The async run
//! returns immediately and reports the outcome via a delegate callback; the
//! worker thread (the async command) only waits on a channel for that result.

/// US-Letter at 72pt/in — the print paper size and the web view's layout box.
pub const PAGE_WIDTH: f64 = 612.0;
pub const PAGE_HEIGHT: f64 = 792.0;
/// Per-page margin, identical on all four sides, applied via `NSPrintInfo` so it
/// repeats on every page. 2cm ≈ 56.7pt; kept in sync with the `@page { margin }`
/// in `html::PRINT_CSS` (which only affects a browser opening a standalone HTML
/// export — the native paths use this value).
pub const PAGE_MARGIN: f64 = 56.7;

#[cfg(target_os = "macos")]
pub use imp::{run, Output, PrintInfoConfig};

#[cfg(target_os = "macos")]
mod imp {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{define_class, sel, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSBackingStoreType, NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob,
        NSPrintingPaginationMode, NSWindow, NSWindowStyleMask,
    };
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{NSObject, NSString, NSURL};
    use objc2_web_kit::{WKWebView, WKWebViewConfiguration};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::ptr::null_mut;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Manager};

    use super::{PAGE_HEIGHT, PAGE_MARGIN, PAGE_WIDTH};

    /// Far enough offscreen that the host window never flickers into view.
    const OFFSCREEN_ORIGIN: f64 = -100_000.0;
    /// Bounds the page LOAD only — once the (Print) panel is up the user may
    /// leave it open as long as they like.
    const LOAD_TIMEOUT: Duration = Duration::from_secs(25);
    const POLL_INTERVAL: Duration = Duration::from_millis(80);

    /// What a caller wants from the operation, and how its result is reported.
    pub enum PrintInfoConfig {
        /// Save the paginated PDF to `path` (no panels). Success → the PDF bytes
        /// are read back from the file.
        SaveToPdf { path: std::path::PathBuf },
        /// Show the system print panel. Success → whether the user printed.
        ShowPanel,
    }

    /// The result handed back to the worker thread once the run completes.
    pub enum Output {
        /// PDF bytes (the `SaveToPdf` path).
        Pdf(Vec<u8>),
        /// Whether the user printed vs cancelled (the `ShowPanel` path).
        Printed(bool),
    }

    /// A live job: the web view, the offscreen window hosting it, the requested
    /// configuration, and (once the run starts) the delegate. All held until the
    /// callback fires (or the load times out) so none is released mid-run.
    struct Job {
        webview: Retained<WKWebView>,
        window: Retained<NSWindow>,
        /// The visible main app window the print sheet/modal attaches to, so the
        /// panel appears centered on-screen rather than on the offscreen render
        /// host. `None` only if it can't be resolved (then we fall back to `window`).
        main_window: Option<Retained<NSWindow>>,
        config: PrintInfoConfig,
        delegate: Option<Retained<RunDelegate>>,
    }

    thread_local! {
        /// Live jobs, by id. Main-thread-only (`!Send`); every accessor runs
        /// inside `run_on_main_thread`.
        static JOBS: RefCell<HashMap<u64, Job>> = RefCell::new(HashMap::new());
    }

    define_class!(
        /// Receives `printOperationDidRun:success:contextInfo:` from the async run,
        /// turns it into an [`Output`] (reading the saved PDF for the save path),
        /// forwards it to the waiting worker, and retires the job. One instance per
        /// job; it carries the job id and the result channel in its ivars.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "ComposePagedRunDelegate"]
        #[ivars = RunDelegateIvars]
        struct RunDelegate;

        impl RunDelegate {
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn print_operation_did_run(
                &self,
                _operation: *mut AnyObject,
                success: bool,
                _context_info: *mut c_void,
            ) {
                // A save job runs — and calls back — on a thread `NSPrintOperation`
                // spawns for it, but the job map is main-thread-only. So hop the
                // completion back to the main thread to resolve the outcome and
                // retire the job. Copy what's needed off `self` first: retiring the
                // job drops the `Retained<RunDelegate>` it holds.
                let job_id = self.ivars().job_id;
                let tx = self.ivars().tx.borrow_mut().take();
                let _ = self.ivars().app.run_on_main_thread(move || {
                    let outcome = finish_job(job_id, success);
                    if let Some(tx) = tx {
                        let _ = tx.send(outcome);
                    }
                });
            }
        }
    );

    struct RunDelegateIvars {
        job_id: u64,
        /// Hops the completion back to the main thread — the print op may call
        /// back on a thread it spawned, and the job map is main-thread-only.
        app: AppHandle,
        tx: RefCell<Option<Sender<Result<Output, String>>>>,
    }

    impl RunDelegate {
        fn new(
            mtm: MainThreadMarker,
            job_id: u64,
            app: AppHandle,
            tx: Sender<Result<Output, String>>,
        ) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(RunDelegateIvars {
                job_id,
                app,
                tx: RefCell::new(Some(tx)),
            });
            unsafe { objc2::msg_send![super(this), init] }
        }
    }

    /// Build the [`Output`] for a finished run and drop the job (releasing its
    /// window + web view). For the save path, a successful run means the PDF is on
    /// disk: read it back into bytes.
    fn finish_job(job_id: u64, success: bool) -> Result<Output, String> {
        let config = JOBS.with(|jobs| jobs.borrow_mut().remove(&job_id).map(|job| job.config));
        match config {
            None => Err("paged job vanished before completion".into()),
            Some(PrintInfoConfig::ShowPanel) => Ok(Output::Printed(success)),
            Some(PrintInfoConfig::SaveToPdf { path }) => {
                if !success {
                    eprintln!("paged export: NSPrintOperation reported failure for {}", path.display());
                    return Err("the PDF print operation reported failure".into());
                }
                match std::fs::read(&path) {
                    Ok(bytes) => {
                        eprintln!("paged export: saved {} bytes to {}", bytes.len(), path.display());
                        Ok(Output::Pdf(bytes))
                    }
                    Err(error) => {
                        eprintln!("paged export: nothing written at {} ({error})", path.display());
                        Err(format!("could not read the generated PDF: {error}"))
                    }
                }
            }
        }
    }

    fn next_job_id() -> u64 {
        static COUNTER: AtomicU64 = AtomicU64::new(1);
        COUNTER.fetch_add(1, Ordering::Relaxed)
    }

    /// Render `html` offscreen and run an `NSPrintOperation` over it per `config`,
    /// blocking the calling (worker) thread until the run completes or the load
    /// times out.
    pub fn run(app: &AppHandle, html: &str, config: PrintInfoConfig) -> Result<Output, String> {
        let (tx, rx) = channel::<Result<Output, String>>();
        let job_id = next_job_id();

        start_load(app, job_id, html, config, tx.clone())?;

        // Poll readiness until the page settles, then kick off the operation.
        // `started` flips once the async run has launched, so we stop scheduling
        // readiness checks and just wait for the delegate's callback.
        let started = Arc::new(AtomicBool::new(false));
        let load_deadline = Instant::now() + LOAD_TIMEOUT;
        loop {
            match rx.recv_timeout(POLL_INTERVAL) {
                Ok(result) => return result,
                Err(RecvTimeoutError::Disconnected) => return Err("paged run channel closed".into()),
                Err(RecvTimeoutError::Timeout) => {
                    if started.load(Ordering::Acquire) {
                        continue; // operation is running; just wait for the result.
                    }
                    if Instant::now() >= load_deadline {
                        cleanup(app, job_id);
                        return Err("paged render timed out".into());
                    }
                    run_when_ready(app, job_id, tx.clone(), started.clone());
                }
            }
        }
    }

    /// On the main thread: create the offscreen web view, host it in an offscreen
    /// window, and start the HTML load.
    fn start_load(
        app: &AppHandle,
        job_id: u64,
        html: &str,
        config: PrintInfoConfig,
        tx_err: Sender<Result<Output, String>>,
    ) -> Result<(), String> {
        let html_owned = html.to_string();
        let config = RefCell::new(Some(config));
        let app_for_window = app.clone();
        app.run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else {
                let _ = tx_err.send(Err("paged render not on the main thread".into()));
                return;
            };
            let frame = page_rect(0.0, 0.0);
            let webview = unsafe {
                let conf = WKWebViewConfiguration::new(mtm);
                WKWebView::initWithFrame_configuration(WKWebView::alloc(mtm), frame, &conf)
            };
            let window = make_offscreen_window(mtm);
            window.setContentView(Some(webview.as_ref()));
            // Resolve the visible main app window for the print sheet/modal. The
            // webview still renders through its own offscreen host (`window`); this
            // is only where the panel attaches, so it appears centered on-screen.
            let main_window = app_for_window
                .get_webview_window("main")
                .and_then(|w| w.ns_window().ok())
                .and_then(|ptr| unsafe { Retained::retain(ptr.cast::<NSWindow>()) });
            let html_ns = NSString::from_str(&html_owned);
            unsafe { webview.loadHTMLString_baseURL(&html_ns, None) };
            JOBS.with(|jobs| {
                jobs.borrow_mut().insert(
                    job_id,
                    Job {
                        webview,
                        window,
                        main_window,
                        config: config.borrow_mut().take().expect("config taken once"),
                        delegate: None,
                    },
                );
            });
        })
        .map_err(|error| format!("failed to start paged render: {error}"))
    }

    /// On the main thread: once the page has loaded, configure and launch the
    /// operation asynchronously. The job stays in the map (window, web view, and
    /// delegate must outlive the async run); the delegate retires it on completion.
    fn run_when_ready(
        app: &AppHandle,
        job_id: u64,
        tx: Sender<Result<Output, String>>,
        started: Arc<AtomicBool>,
    ) {
        let app_for_delegate = app.clone();
        let _ = app.run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            // Launch at most once. The worker loop schedules this every poll until
            // `started` is observed, so several can queue before the first sets it;
            // a second launch's delegate fires after the first retired the job,
            // surfacing as "paged job vanished" and a failed export.
            if started.load(Ordering::Acquire) {
                return;
            }
            let ready = JOBS.with(|jobs| {
                jobs.borrow()
                    .get(&job_id)
                    .map(|job| !unsafe { job.webview.isLoading() })
                    .unwrap_or(false)
            });
            if !ready {
                return;
            }
            started.store(true, Ordering::Release);
            let delegate = RunDelegate::new(mtm, job_id, app_for_delegate, tx);
            JOBS.with(|jobs| {
                if let Some(job) = jobs.borrow_mut().get_mut(&job_id) {
                    job.delegate = Some(delegate.clone());
                }
            });
            launch_operation(&delegate, job_id);
        });
    }

    /// Configure a fresh print setup per the job's [`PrintInfoConfig`] and launch
    /// the operation asynchronously via `runOperationModalForWindow:`; the
    /// `delegate` reports the outcome and retires the job.
    fn launch_operation(delegate: &RunDelegate, job_id: u64) {
        let (webview, window, main_window, save_path) = JOBS
            .with(|jobs| {
                jobs.borrow().get(&job_id).map(|job| {
                    let save_path = match &job.config {
                        PrintInfoConfig::SaveToPdf { path } => Some(path.clone()),
                        PrintInfoConfig::ShowPanel => None,
                    };
                    (
                        Retained::clone(&job.webview),
                        Retained::clone(&job.window),
                        job.main_window.clone(),
                        save_path,
                    )
                })
            })
            .expect("job present while launching its operation");
        let show_panel = save_path.is_none();
        // Attach the modal/sheet to the visible main window (centered); fall back to
        // the offscreen host only if the main window couldn't be resolved.
        let modal_window: &NSWindow = main_window.as_deref().unwrap_or(&window);

        let print_info = configure_print_info(save_path.as_deref());
        let operation = unsafe { webview.printOperationWithPrintInfo(&print_info) };
        operation.setShowsPrintPanel(show_panel);
        operation.setShowsProgressPanel(show_panel);
        // Sizing the operation's view to the paper is required — the run crashes
        // otherwise (an offscreen WKWebView has no window-derived print frame).
        if let Some(view) = operation.view() {
            view.setFrame(page_rect(0.0, 0.0));
        }
        let delegate_obj: &AnyObject = delegate.as_ref();
        unsafe {
            operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                modal_window,
                Some(delegate_obj),
                Some(sel!(printOperationDidRun:success:contextInfo:)),
                null_mut(),
            );
        }
    }

    /// A fresh `NSPrintInfo` (not the app-wide shared one) sized to US-Letter with
    /// identical margins on every side (the single source of per-page margins).
    /// When `save_path` is set, the operation writes a PDF to that file instead of
    /// spooling to a printer.
    fn configure_print_info(save_path: Option<&std::path::Path>) -> Retained<NSPrintInfo> {
        let print_info = NSPrintInfo::new();
        print_info.setPaperSize(CGSize {
            width: PAGE_WIDTH,
            height: PAGE_HEIGHT,
        });
        print_info.setLeftMargin(PAGE_MARGIN);
        print_info.setRightMargin(PAGE_MARGIN);
        print_info.setTopMargin(PAGE_MARGIN);
        print_info.setBottomMargin(PAGE_MARGIN);
        print_info.setHorizontallyCentered(false);
        print_info.setVerticallyCentered(false);
        // Fit wide content to the page width; paginate down the page automatically
        // so the imageable area (paper minus margins) is honoured on every page.
        print_info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
        print_info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
        if let Some(path) = save_path {
            set_save_to_pdf(&print_info, path);
        }
        print_info
    }

    /// Point an `NSPrintInfo` at a file: disposition = save, destination = the
    /// file URL. The async run then writes the paginated PDF there.
    fn set_save_to_pdf(print_info: &NSPrintInfo, path: &std::path::Path) {
        // `NSPrintSaveJob` / `NSPrintJobSavingURL` are extern statics (reading
        // them is unsafe); the calls themselves are safe.
        print_info.setJobDisposition(unsafe { NSPrintSaveJob });
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let dictionary = unsafe { print_info.dictionary() };
        // The dictionary's value type is `AnyObject`; the key is an
        // `NSPrintInfoAttributeKey` (an `NSString`, which is `NSCopying`).
        dictionary.insert(unsafe { NSPrintJobSavingURL }, url.as_ref() as &AnyObject);
    }

    /// A borderless, never-ordered window placed far offscreen, used only to give
    /// the print web view a live view hierarchy to render through.
    fn make_offscreen_window(mtm: MainThreadMarker) -> Retained<NSWindow> {
        let rect = page_rect(OFFSCREEN_ORIGIN, OFFSCREEN_ORIGIN);
        unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(
                NSWindow::alloc(mtm),
                rect,
                NSWindowStyleMask::Borderless,
                NSBackingStoreType::Buffered,
                false,
            )
        }
    }

    fn page_rect(x: f64, y: f64) -> CGRect {
        CGRect {
            origin: CGPoint { x, y },
            size: CGSize {
                width: PAGE_WIDTH,
                height: PAGE_HEIGHT,
            },
        }
    }

    /// Drop a job (load timeout), on the main thread.
    fn cleanup(app: &AppHandle, job_id: u64) {
        let _ = app.run_on_main_thread(move || {
            JOBS.with(|jobs| {
                jobs.borrow_mut().remove(&job_id);
            });
        });
    }
}
