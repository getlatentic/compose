//! A note's local pictures, inlined into the export as `data:` URIs.

use std::path::Path;

/// Rewrite `<img src="…">` whose source is a local path to an inline base64
/// `data:` URI. http(s)/data/protocol-relative sources are left untouched; a
/// path that can't be read is left untouched (renders as a broken image rather
/// than failing the whole export).
pub(in crate::export) fn inline_local_images(html: &str, doc_dir: &Path) -> String {
    let needle = "src=\"";
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(pos) = rest.find(needle) {
        let (head, after) = rest.split_at(pos + needle.len());
        out.push_str(head);
        let Some(end) = after.find('"') else {
            // Malformed; emit the remainder verbatim and stop.
            out.push_str(after);
            return out;
        };
        let url = &after[..end];
        match inline_one(url, doc_dir) {
            Some(data_uri) => out.push_str(&data_uri),
            None => out.push_str(url),
        }
        out.push('"');
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

/// A `data:` URI for one local image source, or `None` to leave it as-is:
/// external, already inlined, or not an image Compose will read.
pub(super) fn inline_one(url: &str, doc_dir: &Path) -> Option<String> {
    let lower = url.to_ascii_lowercase();
    if lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("data:")
        || url.starts_with("//")
    {
        return None;
    }
    let decoded = percent_decode(url);
    let candidate = Path::new(&decoded);
    let path = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        doc_dir.join(candidate)
    };
    crate::image_file::data_uri(&path)
}

/// Minimal percent-decoding for image paths (handles `%20` etc.). Invalid
/// escapes are passed through literally.
pub(super) fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            if let (Some(hi), Some(lo)) = (hi, lo) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
