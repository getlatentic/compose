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
    use objc2_app_kit::{NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob, NSPrintingPaginationMode, NSWindow};
    use objc2_core_foundation::CGSize;
    use objc2_foundation::{NSObject, NSString, NSURL};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ffi::c_void;
    use std::ptr::null_mut;
    use std::sync::mpsc::{channel, Sender};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Manager};

    use super::super::offscreen::{self, rect, Page, Readiness};
    use super::{PAGE_HEIGHT, PAGE_MARGIN, PAGE_WIDTH};

    /// Bounds the page LOAD only: once the Print panel is up the writer may
    /// leave it open as long as they like.
    const LOAD_TIMEOUT: Duration = Duration::from_secs(25);
    /// A save-to-PDF run shows no panel, so it gets a bound of its own.
    const SAVE_TIMEOUT: Duration = Duration::from_secs(60);

    const PAPER: CGSize = CGSize { width: PAGE_WIDTH, height: PAGE_HEIGHT };

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

    /// A running operation's configuration and delegate, kept (with its
    /// offscreen page, same id) until the delegate reports the outcome.
    struct Job {
        config: PrintInfoConfig,
        /// Held only to keep it alive: the operation does not retain it.
        _delegate: Retained<RunDelegate>,
    }

    thread_local! {
        /// Running jobs, by page id; main-thread-only.
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

    /// Build the [`Output`] for a finished run and release the job and its
    /// page. For the save path, a successful run means the PDF is on disk:
    /// read it back into bytes.
    fn finish_job(job_id: u64, success: bool) -> Result<Output, String> {
        let config = JOBS.with(|jobs| jobs.borrow_mut().remove(&job_id).map(|job| job.config));
        offscreen::close_on_main_thread(job_id);
        match config {
            None => Err("paged job vanished before completion".into()),
            Some(PrintInfoConfig::ShowPanel) => Ok(Output::Printed(success)),
            Some(PrintInfoConfig::SaveToPdf { path }) => read_saved_pdf(&path, success),
        }
    }

    fn read_saved_pdf(path: &std::path::Path, success: bool) -> Result<Output, String> {
        if !success {
            eprintln!("paged export: NSPrintOperation reported failure for {}", path.display());
            return Err("the PDF print operation reported failure".into());
        }
        std::fs::read(path).map(Output::Pdf).map_err(|error| {
            eprintln!("paged export: nothing written at {} ({error})", path.display());
            format!("could not read the generated PDF: {error}")
        })
    }

    /// Render `html` offscreen and run an `NSPrintOperation` over it per
    /// `config`, blocking the calling (worker) thread until the run completes
    /// or the load times out.
    pub fn run(app: &AppHandle, html: &str, config: PrintInfoConfig) -> Result<Output, String> {
        let page = offscreen::open(app, html.to_owned(), PAPER)?;
        if let Err(error) = offscreen::wait_until_ready(app, page, Readiness::Loaded, Instant::now() + LOAD_TIMEOUT) {
            offscreen::close(app, page);
            return Err(error);
        }
        let wait = match config {
            PrintInfoConfig::SaveToPdf { .. } => Some(SAVE_TIMEOUT),
            PrintInfoConfig::ShowPanel => None,
        };
        let (tx, rx) = channel::<Result<Output, String>>();
        let delegate_app = app.clone();
        offscreen::with_page(app, page, move |mtm, found| match found {
            Some(found) => launch(mtm, page, found, config, delegate_app, tx),
            None => {
                let _ = tx.send(Err("the page closed before printing".into()));
            }
        })?;
        match wait {
            Some(limit) => rx.recv_timeout(limit).unwrap_or_else(|_| {
                offscreen::close(app, page);
                Err("the PDF took too long to write".into())
            }),
            None => rx.recv().unwrap_or_else(|_| Err("paged run channel closed".into())),
        }
    }

    /// The visible main window, which the print sheet attaches to so it
    /// appears on screen rather than on the offscreen page. Main thread only.
    fn main_window(app: &AppHandle) -> Option<Retained<NSWindow>> {
        let ptr = app.get_webview_window("main")?.ns_window().ok()?;
        unsafe { Retained::retain(ptr.cast::<NSWindow>()) }
    }

    /// On the main thread: configure the operation and launch it
    /// asynchronously; the delegate reports the outcome and retires the job.
    fn launch(
        mtm: MainThreadMarker,
        page_id: u64,
        page: &Page,
        config: PrintInfoConfig,
        app: AppHandle,
        tx: Sender<Result<Output, String>>,
    ) {
        let save_path = match &config {
            PrintInfoConfig::SaveToPdf { path } => Some(path.clone()),
            PrintInfoConfig::ShowPanel => None,
        };
        let main_window = main_window(&app);
        let delegate = RunDelegate::new(mtm, page_id, app, tx);
        JOBS.with(|jobs| jobs.borrow_mut().insert(page_id, Job { config, _delegate: delegate.clone() }));
        let modal_window: &NSWindow = main_window.as_deref().unwrap_or(&page.window);

        let show_panel = save_path.is_none();
        let print_info = configure_print_info(save_path.as_deref());
        let operation = unsafe { page.webview.printOperationWithPrintInfo(&print_info) };
        operation.setShowsPrintPanel(show_panel);
        operation.setShowsProgressPanel(show_panel);
        // Sizing the operation's view to the paper is required: the run crashes
        // otherwise (an offscreen WKWebView has no window-derived print frame).
        if let Some(view) = operation.view() {
            view.setFrame(rect(0.0, 0.0, PAPER));
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
}
