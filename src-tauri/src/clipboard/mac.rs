//! The macOS clipboard: what a copy left on it, and putting a history entry back
//! in every form it had. AppKit's pasteboard is used from the main thread only.

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2_app_kit::{
    NSBitmapImageFileType, NSBitmapImageRep, NSPasteboard, NSPasteboardAccessBehavior, NSPasteboardTypeFileURL,
    NSPasteboardTypeHTML, NSPasteboardTypePNG, NSPasteboardTypeString, NSPasteboardTypeTIFF, NSPasteboardWriting,
    NSWorkspace,
};
use objc2_foundation::{NSArray, NSData, NSDictionary, NSString, NSURL};

use super::copy::{is_private, Copy};
use super::ClipboardAccess;
use crate::db::clipboard_history::{ClipboardItem, ClipboardKind};

const PRIVACY_SETTINGS: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_Pasteboard";

/// Goes up by one with every copy, by any app: how a new copy is noticed.
pub(super) fn change_count() -> isize {
    NSPasteboard::generalPasteboard().changeCount()
}

/// What macOS lets Compose read of other apps' copies. Before macOS 15.4 it
/// never asks.
pub(super) fn access() -> ClipboardAccess {
    if objc2::available!(macos = 15.4) {
        access_for(NSPasteboard::generalPasteboard().accessBehavior())
    } else {
        ClipboardAccess::Allowed
    }
}

/// An app macOS has not yet asked about reads freely until the first read,
/// which asks once and leaves it asking.
fn access_for(behavior: NSPasteboardAccessBehavior) -> ClipboardAccess {
    match behavior {
        NSPasteboardAccessBehavior::Default | NSPasteboardAccessBehavior::AlwaysAllow => ClipboardAccess::Allowed,
        NSPasteboardAccessBehavior::AlwaysDeny => ClipboardAccess::Denied,
        _ => ClipboardAccess::Asks,
    }
}

pub(super) fn open_privacy_settings() -> Result<(), String> {
    let url = NSURL::URLWithString(&NSString::from_str(PRIVACY_SETTINGS)).ok_or("The settings address is invalid.")?;
    if NSWorkspace::sharedWorkspace().openURL(&url) {
        Ok(())
    } else {
        Err("System Settings did not open.".to_owned())
    }
}

/// What the clipboard holds now. The app in front is taken as the one that
/// copied it: the copy happened a moment ago, in the app the user is using.
pub(super) fn read() -> Copy {
    let front = NSWorkspace::sharedWorkspace().frontmostApplication();
    let source = Copy {
        source_name: front.as_ref().and_then(|app| app.localizedName()).map(|name| name.to_string()),
        source_bundle: front.and_then(|app| app.bundleIdentifier()).map(|bundle| bundle.to_string()),
        ..Copy::default()
    };
    read_from(&NSPasteboard::generalPasteboard(), source, || access() == ClipboardAccess::Allowed)
}

/// `source` with what `board` holds: always its types, and its contents only
/// when the copy is not private. The first read is what makes macOS ask, once,
/// and after it macOS asks at every read — so reading stops there unless
/// `allowed` still holds.
fn read_from(board: &NSPasteboard, source: Copy, allowed: impl Fn() -> bool) -> Copy {
    let copy = Copy {
        types: board
            .types()
            .map(|types| types.iter().map(|kind| kind.to_string()).collect())
            .unwrap_or_default(),
        ..source
    };
    if is_private(&copy) {
        return copy;
    }
    // SAFETY: the type constants are immutable NSStrings AppKit defines.
    let text = unsafe { board.stringForType(NSPasteboardTypeString) }.map(|text| text.to_string());
    if !allowed() {
        return Copy { text, ..copy };
    }
    // SAFETY: as above.
    let html = unsafe { board.stringForType(NSPasteboardTypeHTML) }.map(|html| html.to_string());
    Copy { text, html, png: image_png(board), files: file_paths(board), ..copy }
}

/// The copied image as PNG, converting the TIFF older apps put there.
fn image_png(board: &NSPasteboard) -> Option<Vec<u8>> {
    // SAFETY: as in `read_from`.
    let (png, tiff) = unsafe { (board.dataForType(NSPasteboardTypePNG), board.dataForType(NSPasteboardTypeTIFF)) };
    if let Some(png) = png {
        return Some(png.to_vec());
    }
    let tiff = tiff?;
    let representation = NSBitmapImageRep::imageRepWithData(&tiff)?;
    // SAFETY: an empty properties dictionary asks for the defaults.
    let converted = unsafe { representation.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) };
    converted.map(|png| png.to_vec())
}

/// Copied files, one per clipboard item, as paths.
fn file_paths(board: &NSPasteboard) -> Vec<String> {
    let Some(items) = board.pasteboardItems() else { return Vec::new() };
    items
        .iter()
        .filter_map(|item| {
            // SAFETY: as in `read_from`.
            let url = unsafe { item.stringForType(NSPasteboardTypeFileURL) }?;
            let url = NSURL::URLWithString(&url)?;
            url.isFileURL().then(|| url.path()).flatten().map(|path| path.to_string())
        })
        .collect()
}

/// Put `item` on the clipboard as it was copied: text with its rich version, an
/// image as PNG and TIFF, files as files. `false` when the system refused it.
pub(super) fn write(item: &ClipboardItem) -> bool {
    write_to(&NSPasteboard::generalPasteboard(), item)
}

fn write_to(board: &NSPasteboard, item: &ClipboardItem) -> bool {
    board.clearContents();
    match item.kind {
        ClipboardKind::Files => write_files(board, &item.text),
        ClipboardKind::Image => item.image_png.as_deref().is_some_and(|png| write_image(board, png)),
        ClipboardKind::Text | ClipboardKind::Link => {
            // SAFETY: as in `read_from`.
            unsafe {
                let wrote = board.setString_forType(&NSString::from_str(&item.text), NSPasteboardTypeString);
                if let Some(html) = &item.html {
                    board.setString_forType(&NSString::from_str(html), NSPasteboardTypeHTML);
                }
                wrote
            }
        }
    }
}

fn write_image(board: &NSPasteboard, png: &[u8]) -> bool {
    let png = NSData::with_bytes(png);
    let tiff = NSBitmapImageRep::imageRepWithData(&png).and_then(|representation| representation.TIFFRepresentation());
    // SAFETY: as in `read_from`.
    unsafe {
        let wrote = board.setData_forType(Some(&png), NSPasteboardTypePNG);
        if let Some(tiff) = tiff {
            board.setData_forType(Some(&tiff), NSPasteboardTypeTIFF);
        }
        wrote
    }
}

fn write_files(board: &NSPasteboard, paths: &str) -> bool {
    let urls: Vec<Retained<ProtocolObject<dyn NSPasteboardWriting>>> = paths
        .lines()
        .filter(|path| !path.is_empty())
        .map(|path| ProtocolObject::from_retained(NSURL::fileURLWithPath(&NSString::from_str(path))))
        .collect();
    board.writeObjects(&NSArray::from_retained_slice(&urls))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A private pasteboard of its own: tests never touch the user's clipboard.
    struct Scratch(Retained<NSPasteboard>);

    impl Scratch {
        fn new() -> Self {
            Self(NSPasteboard::pasteboardWithUniqueName())
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            // SAFETY: `- (void)releaseGlobally` on NSPasteboard; the generated bindings leave it out.
            unsafe {
                let _: () = objc2::msg_send![&*self.0, releaseGlobally];
            }
        }
    }

    fn item(kind: ClipboardKind, text: &str, html: Option<&str>, png: Option<Vec<u8>>) -> ClipboardItem {
        ClipboardItem { id: "id".to_owned(), kind, text: text.to_owned(), html: html.map(str::to_owned), image_png: png }
    }

    fn read(board: &NSPasteboard) -> Copy {
        read_from(board, Copy::default(), || true)
    }

    /// The smallest PNG there is: one transparent pixel.
    fn one_pixel_png() -> Vec<u8> {
        base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        )
        .expect("png")
    }

    #[test]
    fn text_goes_back_with_its_rich_version() {
        let board = Scratch::new();
        assert!(write_to(&board.0, &item(ClipboardKind::Text, "Hello", Some("<b>Hello</b>"), None)));
        let copy = read(&board.0);
        assert_eq!(copy.text.as_deref(), Some("Hello"));
        assert_eq!(copy.html.as_deref(), Some("<b>Hello</b>"));
    }

    #[test]
    fn an_image_goes_back_as_png_and_tiff_and_reads_as_png() {
        let board = Scratch::new();
        assert!(write_to(&board.0, &item(ClipboardKind::Image, "", None, Some(one_pixel_png()))));
        let copy = read(&board.0);
        assert!(copy.types.iter().any(|kind| kind == "public.tiff"), "older apps read TIFF: {:?}", copy.types);
        assert_eq!(copy.png, Some(one_pixel_png()));
    }

    #[test]
    fn a_tiff_only_copy_reads_as_png() {
        let board = Scratch::new();
        let png = NSData::with_bytes(&one_pixel_png());
        let tiff = NSBitmapImageRep::imageRepWithData(&png).and_then(|rep| rep.TIFFRepresentation()).expect("tiff");
        board.0.clearContents();
        // SAFETY: as in `read_from`.
        assert!(unsafe { board.0.setData_forType(Some(&tiff), NSPasteboardTypeTIFF) });
        let converted = read(&board.0).png.expect("converted");
        assert_eq!(&converted[1..4], b"PNG");
    }

    #[test]
    fn a_copy_marked_private_is_never_read() {
        let board = Scratch::new();
        board.0.clearContents();
        // SAFETY: as in `read_from`.
        unsafe {
            board.0.setString_forType(&NSString::from_str("hunter2"), NSPasteboardTypeString);
            board.0.setString_forType(&NSString::new(), &NSString::from_str("org.nspasteboard.ConcealedType"));
        }
        let copy = read(&board.0);
        assert!(copy.types.iter().any(|kind| kind == "org.nspasteboard.ConcealedType"));
        assert_eq!(copy.text, None);
    }

    #[test]
    fn reading_stops_after_the_first_read_once_macos_asks() {
        let board = Scratch::new();
        assert!(write_to(&board.0, &item(ClipboardKind::Text, "Hello", Some("<b>Hello</b>"), None)));
        let copy = read_from(&board.0, Copy::default(), || false);
        assert_eq!(copy.text.as_deref(), Some("Hello"));
        assert_eq!(copy.html, None);
    }

    #[test]
    fn only_reading_without_asking_counts_as_allowed() {
        assert_eq!(access_for(NSPasteboardAccessBehavior::Default), ClipboardAccess::Allowed);
        assert_eq!(access_for(NSPasteboardAccessBehavior::AlwaysAllow), ClipboardAccess::Allowed);
        assert_eq!(access_for(NSPasteboardAccessBehavior::Ask), ClipboardAccess::Asks);
        assert_eq!(access_for(NSPasteboardAccessBehavior::AlwaysDeny), ClipboardAccess::Denied);
        assert_eq!(access_for(NSPasteboardAccessBehavior(9)), ClipboardAccess::Asks);
    }

    #[test]
    fn files_go_back_as_files() {
        let board = Scratch::new();
        let paths = "/tmp/compose clip a.pdf\n/tmp/b.png";
        assert!(write_to(&board.0, &item(ClipboardKind::Files, paths, None, None)));
        assert_eq!(read(&board.0).files, ["/tmp/compose clip a.pdf", "/tmp/b.png"]);
    }
}
