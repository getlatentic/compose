//! Handing a drawn card to the rest of the Mac: the clipboard, for pasting
//! into a post, and the system share sheet (Messages, Mail, AirDrop, Notes,
//! Photos and whatever else the Mac offers).
//!
//! Both are AppKit main-thread work, run with `run_on_main_thread` from the
//! command's worker thread, which waits for the answer.

use serde::Deserialize;

/// Where the Share button is, in the window's CSS pixels: the sheet opens
/// against it.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareAnchor {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// A file name for a shared card: its last path part, with the characters a
/// file name cannot hold replaced, and never empty.
pub fn share_file_name(name: &str) -> String {
    let leaf = name.rsplit(['/', '\\']).next().unwrap_or("").trim();
    let cleaned: String = leaf
        .chars()
        .map(|ch| if ch.is_control() || matches!(ch, ':' | '/' | '\\') { '-' } else { ch })
        .collect();
    let cleaned = cleaned.trim_start_matches('.').trim();
    if cleaned.is_empty() {
        "Card.png".to_owned()
    } else {
        cleaned.to_owned()
    }
}

#[cfg(not(target_os = "macos"))]
pub fn copy_png(_app: &tauri::AppHandle, _png: Vec<u8>) -> Result<(), String> {
    Err("Copying an image is only supported on macOS in this build.".to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn show_share_sheet(_window: &tauri::WebviewWindow, _file: std::path::PathBuf, _anchor: ShareAnchor) -> Result<(), String> {
    Err("Sharing is only supported on macOS in this build.".to_string())
}

#[cfg(target_os = "macos")]
pub use imp::{copy_png, show_share_sheet};

#[cfg(target_os = "macos")]
mod imp {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypePNG, NSSharingServicePicker, NSView};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{NSArray, NSData, NSRectEdge, NSString, NSURL};
    use std::cell::RefCell;
    use std::path::PathBuf;
    use std::sync::mpsc::channel;
    use std::time::Duration;
    use tauri::{AppHandle, WebviewWindow};

    use super::ShareAnchor;

    const MAIN_THREAD_WAIT: Duration = Duration::from_secs(5);

    thread_local! {
        /// The open share sheet: AppKit does not keep it alive on its own.
        static PICKER: RefCell<Option<Retained<NSSharingServicePicker>>> = const { RefCell::new(None) };
    }

    /// Put `png` on the general pasteboard as a PNG image.
    pub fn copy_png(app: &AppHandle, png: Vec<u8>) -> Result<(), String> {
        let (tx, rx) = channel();
        app.run_on_main_thread(move || {
            let pasteboard = NSPasteboard::generalPasteboard();
            pasteboard.clearContents();
            let data = NSData::with_bytes(&png);
            let written = pasteboard.setData_forType(Some(&data), unsafe { NSPasteboardTypePNG });
            let _ = tx.send(written);
        })
        .map_err(|error| format!("could not reach the clipboard: {error}"))?;
        match rx.recv_timeout(MAIN_THREAD_WAIT) {
            Ok(true) => Ok(()),
            Ok(false) => Err("The clipboard did not take the image.".to_owned()),
            Err(_) => Err("The clipboard did not answer.".to_owned()),
        }
    }

    /// Open the share sheet for `file`, against `anchor` in `window`.
    pub fn show_share_sheet(window: &WebviewWindow, file: PathBuf, anchor: ShareAnchor) -> Result<(), String> {
        let view = window.ns_view().map_err(|error| format!("no window to share from: {error}"))? as usize;
        let (tx, rx) = channel();
        window
            .run_on_main_thread(move || {
                let Some(_mtm) = MainThreadMarker::new() else {
                    let _ = tx.send(false);
                    return;
                };
                // SAFETY: Tauri hands back the live webview view of this
                // window, which outlives this main-thread call.
                let Some(view) = (unsafe { (view as *mut NSView).as_ref() }) else {
                    let _ = tx.send(false);
                    return;
                };
                let url = NSURL::fileURLWithPath(&NSString::from_str(&file.to_string_lossy()));
                let items = NSArray::from_retained_slice(&[Retained::into_super(Retained::into_super(url)) as Retained<AnyObject>]);
                let picker = unsafe { NSSharingServicePicker::initWithItems(NSSharingServicePicker::alloc(), &items) };
                picker.showRelativeToRect_ofView_preferredEdge(anchor_rect(view, anchor), view, NSRectEdge::MinY);
                PICKER.with(|slot| *slot.borrow_mut() = Some(picker));
                let _ = tx.send(true);
            })
            .map_err(|error| format!("could not open the share sheet: {error}"))?;
        match rx.recv_timeout(MAIN_THREAD_WAIT) {
            Ok(true) => Ok(()),
            _ => Err("The share sheet did not open.".to_owned()),
        }
    }

    /// The anchor in the view's own coordinates: CSS pixels are points, and a
    /// view that is not flipped counts y from the bottom.
    fn anchor_rect(view: &NSView, anchor: ShareAnchor) -> CGRect {
        let y = if view.isFlipped() { anchor.y } else { view.frame().size.height - anchor.y - anchor.height };
        CGRect { origin: CGPoint { x: anchor.x, y }, size: CGSize { width: anchor.width, height: anchor.height } }
    }
}

#[cfg(test)]
mod tests {
    use super::share_file_name;

    #[test]
    fn names_a_shared_card_after_its_note_without_path_or_odd_characters() {
        assert_eq!(share_file_name("notes/Chapter 2: Method.png"), "Chapter 2- Method.png");
        assert_eq!(share_file_name("../../.hidden.png"), "hidden.png");
        assert_eq!(share_file_name("  "), "Card.png");
    }
}
