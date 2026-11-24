//! Image files Compose reads on the writer's behalf: a note's pictures
//! inlined into an export or a card, and the note background. Paths come from
//! note text the web view sends, so a file is read only when its name says it
//! is an image, its size is under [`MAX_BYTES`], and its first bytes agree.

use std::io::Read;
use std::path::Path;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

/// A wallpaper-sized photo is a few MB; anything far larger is not worth
/// decoding into a card, a PDF or behind every repaint of the note.
pub const MAX_BYTES: u64 = 25 * 1024 * 1024;

/// The image's MIME type, judged by its extension, or `None` when the name
/// does not say image.
pub fn mime(path: &Path) -> Option<&'static str> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => return None,
    })
}

/// Whether `head` starts the way a file of `mime` does.
fn has_signature(mime: &str, head: &[u8]) -> bool {
    match mime {
        "image/png" => head.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => head.starts_with(&[0xFF, 0xD8, 0xFF]),
        "image/gif" => head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a"),
        "image/webp" => head.len() >= 12 && head.starts_with(b"RIFF") && &head[8..12] == b"WEBP",
        "image/bmp" => head.starts_with(b"BM"),
        "image/svg+xml" => {
            let text = String::from_utf8_lossy(&head[..head.len().min(512)]);
            let text = text.trim_start_matches('\u{feff}').trim_start();
            text.starts_with("<svg") || text.starts_with("<?xml")
        }
        _ => false,
    }
}

/// The bytes of the image at `path` and their MIME type, or `None` when it is
/// not an image, is over [`MAX_BYTES`], or cannot be read.
pub fn read(path: &Path) -> Option<(Vec<u8>, &'static str)> {
    let mime = mime(path)?;
    let file = std::fs::File::open(path).ok()?;
    if file.metadata().ok()?.len() > MAX_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes).ok()?;
    let fits = bytes.len() as u64 <= MAX_BYTES;
    (fits && has_signature(mime, &bytes)).then_some((bytes, mime))
}

/// The image at `path` as a `data:` URI, under the same rules as [`read`].
pub fn data_uri(path: &Path) -> Option<String> {
    let (bytes, mime) = read(path)?;
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

/// Whether the file at `path` is an image [`read`] would accept, without
/// keeping its bytes.
pub fn is_readable_image(path: &Path) -> bool {
    let Some(mime) = mime(path) else { return false };
    let Ok(file) = std::fs::File::open(path) else { return false };
    let Ok(metadata) = file.metadata() else { return false };
    let mut head = Vec::with_capacity(512);
    let read_head = file.take(512).read_to_end(&mut head).is_ok();
    read_head && metadata.len() <= MAX_BYTES && has_signature(mime, &head)
}

#[cfg(test)]
pub mod fixtures {
    /// The smallest bytes each format's signature check accepts.
    pub const PNG: &[u8] = b"\x89PNG\r\n\x1a\nrest";
    pub const JPEG: &[u8] = &[0xFF, 0xD8, 0xFF, 0xE0, 0, 0];
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_an_image_whose_bytes_match_its_name() {
        let dir = tempfile::tempdir().expect("tempdir");
        let png = dir.path().join("a.PNG");
        std::fs::write(&png, fixtures::PNG).expect("write");
        assert_eq!(read(&png).map(|(_, mime)| mime), Some("image/png"));
        assert!(data_uri(&png).expect("uri").starts_with("data:image/png;base64,"));
    }

    #[test]
    fn refuses_files_that_are_not_images() {
        let dir = tempfile::tempdir().expect("tempdir");
        let key = dir.path().join("id_rsa");
        std::fs::write(&key, b"-----BEGIN OPENSSH PRIVATE KEY-----").expect("write");
        let disguised = dir.path().join("secret.png");
        std::fs::write(&disguised, b"-----BEGIN OPENSSH PRIVATE KEY-----").expect("write");
        assert!(read(&key).is_none());
        assert!(read(&disguised).is_none());
        assert!(!is_readable_image(&disguised));
    }

    #[test]
    fn knows_each_format_by_its_extension() {
        for (name, expected) in [
            ("a.png", "image/png"),
            ("a.jpg", "image/jpeg"),
            ("a.JPEG", "image/jpeg"),
            ("a.gif", "image/gif"),
            ("a.svg", "image/svg+xml"),
            ("a.webp", "image/webp"),
            ("a.bmp", "image/bmp"),
        ] {
            assert_eq!(mime(Path::new(name)), Some(expected), "for {name}");
        }
        assert_eq!(mime(Path::new("notes.txt")), None);
        assert_eq!(mime(Path::new("no-extension")), None);
    }

    #[test]
    fn recognises_svg_and_webp_signatures() {
        assert!(has_signature("image/svg+xml", b"\xEF\xBB\xBF  <svg xmlns='x'/>"));
        assert!(has_signature("image/webp", b"RIFF\0\0\0\0WEBPVP8 "));
        assert!(!has_signature("image/webp", b"RIFF\0\0\0\0WAVE"));
    }
}
