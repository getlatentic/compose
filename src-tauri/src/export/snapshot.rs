//! HTML → image via macOS WebKit: the card from [`super::card`] drawn in an
//! offscreen `WKWebView` at exactly its size, snapshotted, redrawn into a
//! bitmap of exactly the card's pixels (a Retina snapshot is twice that, and
//! a post's size is a promise), then encoded as JPEG or PNG.
//!
//! Threading follows [`super::paged`]: the web view, its offscreen window and
//! the snapshot are main-thread-only, so each step runs inside
//! `run_on_main_thread`; the export command's worker thread polls until the
//! page has loaded, asks for the snapshot, and waits on a channel for the
//! encoded bytes.
//!
//! Like the PDF path, this only runs inside the packaged app (it needs a live
//! AppKit main thread); its output is verified by exporting from the `.app`.

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImageFormat {
    Jpeg,
    Png,
}

impl ImageFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
        }
    }
}

#[cfg(not(target_os = "macos"))]
pub fn render(_app: &tauri::AppHandle, _html: &str, _size: (u32, u32), _format: ImageFormat) -> Result<Vec<u8>, String> {
    Err("Image export is only supported on macOS in this build.".to_string())
}

#[cfg(target_os = "macos")]
pub use imp::render;

#[cfg(target_os = "macos")]
mod imp {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{AnyThread, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSBackingStoreType, NSBitmapImageFileType, NSBitmapImageRep, NSDeviceRGBColorSpace, NSGraphicsContext, NSImage,
        NSImageCompressionFactor, NSWindow, NSWindowStyleMask,
    };
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{NSDictionary, NSError, NSNumber, NSString};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView, WKWebViewConfiguration};
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::ptr::null_mut;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use tauri::AppHandle;

    use super::ImageFormat;

    const OFFSCREEN_ORIGIN: f64 = -100_000.0;
    const TIMEOUT: Duration = Duration::from_secs(25);
    const POLL_INTERVAL: Duration = Duration::from_millis(80);
    /// After the page reports loaded, embedded fonts and the background image
    /// still decode; a beat later they are drawn.
    const SETTLE: Duration = Duration::from_millis(350);
    const JPEG_QUALITY: f64 = 0.92;

    struct Job {
        webview: Retained<WKWebView>,
        _window: Retained<NSWindow>,
    }

    thread_local! {
        /// Live jobs, by id; main-thread-only, like the views they hold.
        static JOBS: RefCell<HashMap<u64, Job>> = RefCell::new(HashMap::new());
    }

    fn next_job_id() -> u64 {
        static COUNTER: AtomicU64 = AtomicU64::new(1);
        COUNTER.fetch_add(1, Ordering::Relaxed)
    }

    fn rect(x: f64, y: f64, (width, height): (u32, u32)) -> CGRect {
        CGRect { origin: CGPoint { x, y }, size: CGSize { width: f64::from(width), height: f64::from(height) } }
    }

    /// Draw `html` at `size` CSS pixels and return it encoded as `format`,
    /// exactly `size` pixels. Blocks the calling (worker) thread.
    pub fn render(app: &AppHandle, html: &str, size: (u32, u32), format: ImageFormat) -> Result<Vec<u8>, String> {
        let (tx, rx) = channel::<Result<Vec<u8>, String>>();
        let job_id = next_job_id();
        start(app, job_id, html.to_owned(), size, tx.clone())?;

        let requested = Arc::new(AtomicBool::new(false));
        let deadline = Instant::now() + TIMEOUT;
        let mut loaded_at: Option<Instant> = None;
        loop {
            match rx.recv_timeout(POLL_INTERVAL) {
                Ok(result) => return result,
                Err(RecvTimeoutError::Disconnected) => return Err("image render channel closed".into()),
                Err(RecvTimeoutError::Timeout) => {}
            }
            if Instant::now() >= deadline {
                finish(app, job_id);
                return Err("the image took too long to draw".into());
            }
            if requested.load(Ordering::Acquire) {
                continue;
            }
            match loaded_at {
                None if is_loaded(app, job_id) => loaded_at = Some(Instant::now()),
                Some(at) if at.elapsed() >= SETTLE => {
                    requested.store(true, Ordering::Release);
                    snapshot(app, job_id, size, format, tx.clone());
                }
                _ => {}
            }
        }
    }

    fn start(app: &AppHandle, job_id: u64, html: String, size: (u32, u32), tx: Sender<Result<Vec<u8>, String>>) -> Result<(), String> {
        app.run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else {
                let _ = tx.send(Err("image render not on the main thread".into()));
                return;
            };
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
            unsafe { webview.loadHTMLString_baseURL(&NSString::from_str(&html), None) };
            JOBS.with(|jobs| jobs.borrow_mut().insert(job_id, Job { webview, _window: window }));
        })
        .map_err(|error| format!("could not start drawing the image: {error}"))
    }

    /// Whether the page has loaded. Asked from the worker; answered on the
    /// main thread.
    fn is_loaded(app: &AppHandle, job_id: u64) -> bool {
        let (tx, rx) = channel();
        let _ = app.run_on_main_thread(move || {
            let loaded = JOBS.with(|jobs| jobs.borrow().get(&job_id).map(|job| !unsafe { job.webview.isLoading() }).unwrap_or(false));
            let _ = tx.send(loaded);
        });
        rx.recv_timeout(Duration::from_secs(2)).unwrap_or(false)
    }

    fn snapshot(app: &AppHandle, job_id: u64, size: (u32, u32), format: ImageFormat, tx: Sender<Result<Vec<u8>, String>>) {
        let _ = app.run_on_main_thread(move || {
            let Some(mtm) = MainThreadMarker::new() else {
                let _ = tx.send(Err("image snapshot not on the main thread".into()));
                return;
            };
            let Some(webview) = JOBS.with(|jobs| jobs.borrow().get(&job_id).map(|job| Retained::clone(&job.webview))) else {
                let _ = tx.send(Err("the image render was dropped".into()));
                return;
            };
            let configuration = unsafe { WKSnapshotConfiguration::new(mtm) };
            unsafe {
                configuration.setRect(rect(0.0, 0.0, size));
                configuration.setAfterScreenUpdates(true);
            }
            let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                let result = match unsafe { image.as_ref() } {
                    Some(image) => encode(image, size, format).ok_or_else(|| "could not encode the image".to_owned()),
                    None => Err(unsafe { error.as_ref() }
                        .map(|error| error.localizedDescription().to_string())
                        .unwrap_or_else(|| "WebKit returned no image".to_owned())),
                };
                JOBS.with(|jobs| jobs.borrow_mut().remove(&job_id));
                let _ = tx.send(result);
            });
            unsafe { webview.takeSnapshotWithConfiguration_completionHandler(Some(&configuration), &handler) };
        });
    }

    /// The snapshot redrawn into a bitmap of exactly `size` pixels, encoded.
    fn encode(image: &NSImage, (width, height): (u32, u32), format: ImageFormat) -> Option<Vec<u8>> {
        let bitmap = unsafe {
            NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
                NSBitmapImageRep::alloc(),
                null_mut(),
                width as isize,
                height as isize,
                8,
                4,
                true,
                false,
                NSDeviceRGBColorSpace,
                0,
                0,
            )
        }?;
        bitmap.setSize(CGSize { width: f64::from(width), height: f64::from(height) });
        let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&bitmap)?;
        NSGraphicsContext::saveGraphicsState_class();
        NSGraphicsContext::setCurrentContext(Some(&context));
        image.drawInRect(rect(0.0, 0.0, (width, height)));
        context.flushGraphics();
        NSGraphicsContext::restoreGraphicsState_class();

        let quality = NSNumber::new_f64(JPEG_QUALITY);
        let (file_type, properties) = match format {
            ImageFormat::Jpeg => (
                NSBitmapImageFileType::JPEG,
                NSDictionary::from_slices(&[unsafe { NSImageCompressionFactor }], &[quality.as_ref() as &AnyObject]),
            ),
            ImageFormat::Png => (NSBitmapImageFileType::PNG, NSDictionary::new()),
        };
        let data = unsafe { bitmap.representationUsingType_properties(file_type, &properties) }?;
        Some(data.to_vec())
    }

    /// Drop a job (a timeout), on the main thread.
    fn finish(app: &AppHandle, job_id: u64) {
        let _ = app.run_on_main_thread(move || {
            JOBS.with(|jobs| jobs.borrow_mut().remove(&job_id));
        });
    }
}
