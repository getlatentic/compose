//! HTML → image via macOS WebKit: the card from [`super::card`] drawn in an
//! offscreen `WKWebView` at exactly its size, snapshotted, redrawn into a
//! bitmap of exactly the card's pixels (a Retina snapshot is twice that, and
//! a post's size is a promise), then encoded as JPEG or PNG.
//!
//! The page is drawn in an [`super::offscreen`] web view; the worker thread
//! waits until the card marks itself ready (images in, fonts loaded, text
//! fitted), asks for the snapshot on the main thread, and waits on a channel
//! for the encoded bytes.
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
    use objc2::runtime::AnyObject;
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{
        NSBitmapImageFileType, NSBitmapImageRep, NSColorSpace, NSDeviceRGBColorSpace, NSGraphicsContext, NSImage,
        NSImageCompressionFactor,
    };
    use objc2_core_foundation::CGSize;
    use objc2_foundation::{NSDictionary, NSError, NSNumber};
    use objc2_web_kit::WKSnapshotConfiguration;
    use std::ptr::null_mut;
    use std::sync::mpsc::{channel, Sender};
    use std::time::{Duration, Instant};
    use tauri::AppHandle;

    use super::super::offscreen::{self, rect, Page, Readiness};
    use super::ImageFormat;

    const TIMEOUT: Duration = Duration::from_secs(25);
    const JPEG_QUALITY: f64 = 0.92;

    type Reply = Sender<Result<Vec<u8>, String>>;

    fn points((width, height): (u32, u32)) -> CGSize {
        CGSize { width: f64::from(width), height: f64::from(height) }
    }

    /// Draw `html` at `size` CSS pixels and return it encoded as `format`,
    /// exactly `size` pixels. Blocks the calling (worker) thread.
    pub fn render(app: &AppHandle, html: &str, size: (u32, u32), format: ImageFormat) -> Result<Vec<u8>, String> {
        let deadline = Instant::now() + TIMEOUT;
        let page = offscreen::open(app, html.to_owned(), points(size))?;
        let result = draw(app, page, size, format, deadline);
        offscreen::close(app, page);
        result
    }

    fn draw(app: &AppHandle, page: u64, size: (u32, u32), format: ImageFormat, deadline: Instant) -> Result<Vec<u8>, String> {
        offscreen::wait_until_ready(app, page, Readiness::MarkedReady, deadline)?;
        let (tx, rx) = channel();
        offscreen::with_page(app, page, move |mtm, page| match page {
            Some(page) => snapshot(mtm, page, size, format, tx),
            None => {
                let _ = tx.send(Err("the image render was dropped".into()));
            }
        })?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        rx.recv_timeout(remaining).map_err(|_| "the image took too long to draw".to_owned())?
    }

    fn snapshot(mtm: MainThreadMarker, page: &Page, size: (u32, u32), format: ImageFormat, tx: Reply) {
        let configuration = unsafe { WKSnapshotConfiguration::new(mtm) };
        unsafe {
            configuration.setRect(rect(0.0, 0.0, points(size)));
            configuration.setAfterScreenUpdates(true);
        }
        let handler = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
            let result = match unsafe { image.as_ref() } {
                Some(image) => encode(image, size, format).ok_or_else(|| "could not encode the image".to_owned()),
                None => Err(unsafe { error.as_ref() }
                    .map(|error| error.localizedDescription().to_string())
                    .unwrap_or_else(|| "WebKit returned no image".to_owned())),
            };
            let _ = tx.send(result);
        });
        unsafe { page.webview.takeSnapshotWithConfiguration_completionHandler(Some(&configuration), &handler) };
    }

    /// The snapshot redrawn into an sRGB bitmap of exactly `size` pixels (a
    /// Retina snapshot is twice that), encoded.
    fn encode(image: &NSImage, (width, height): (u32, u32), format: ImageFormat) -> Option<Vec<u8>> {
        let drawn = unsafe {
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
        drawn.setSize(points((width, height)));
        let context = NSGraphicsContext::graphicsContextWithBitmapImageRep(&drawn)?;
        NSGraphicsContext::saveGraphicsState_class();
        NSGraphicsContext::setCurrentContext(Some(&context));
        image.drawInRect(rect(0.0, 0.0, points((width, height))));
        context.flushGraphics();
        NSGraphicsContext::restoreGraphicsState_class();
        // Declared sRGB, so the theme's hex colours read the same in every
        // app, not shifted by the display the export ran on.
        let bitmap = drawn.bitmapImageRepByRetaggingWithColorSpace(&NSColorSpace::sRGBColorSpace())?;

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
}
