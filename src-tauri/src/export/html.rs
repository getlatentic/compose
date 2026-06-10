//! Markdown → standalone HTML for PDF export.
//!
//! Renders a document's markdown to a *self-contained* HTML string:
//!
//! - **GFM** via comrak (tables, strikethrough, task lists, autolinks,
//!   footnotes).
//! - **YAML frontmatter is dropped** — it is document metadata, not body, so
//!   comrak's `front_matter_delimiter` recognizes and skips it.
//! - **Raw inline HTML is escaped** (comrak's safe default), so the export
//!   webview never executes scripts embedded in a document.
//! - **Local images are inlined** as base64 `data:` URIs, so the rendered HTML
//!   has no external/file dependencies and the PDF webview needs no filesystem
//!   access (which sidesteps WKWebView's file-subresource sandboxing).
//!
//! The output is a complete `<!doctype html>` document with an embedded print
//! stylesheet, ready to hand to `export::pdf`.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use std::path::Path;

/// Render `markdown` to a complete, self-contained HTML document.
///
/// `title` becomes the document `<title>` (used by the PDF metadata, not shown
/// in the body). `doc_dir` is the directory the document lives in, used to
/// resolve relative image paths for inlining.
pub fn render_markdown_to_html(markdown: &str, title: &str, doc_dir: &Path) -> String {
    let body = markdown_to_body(markdown);
    let body = inline_local_images(&body, doc_dir);
    wrap_document(title, &body)
}

/// comrak GFM render of the body. Frontmatter skipped; raw HTML escaped.
fn markdown_to_body(markdown: &str) -> String {
    let mut options = comrak::Options::default();
    options.extension.table = true;
    options.extension.strikethrough = true;
    options.extension.tasklist = true;
    options.extension.autolink = true;
    options.extension.footnotes = true;
    options.extension.superscript = true;
    // Recognize and skip a leading `---\n…\n---` YAML block.
    options.extension.front_matter_delimiter = Some("---".to_string());
    // `render.unsafe_` stays false: raw inline HTML is escaped rather than
    // passed through, so a document can never inject a runnable <script> into
    // the export webview.
    comrak::markdown_to_html(markdown, &options)
}

/// Rewrite `<img src="…">` whose source is a local path to an inline base64
/// `data:` URI. http(s)/data/protocol-relative sources are left untouched; a
/// path that can't be read is left untouched (renders as a broken image rather
/// than failing the whole export).
fn inline_local_images(html: &str, doc_dir: &Path) -> String {
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

/// Build a `data:` URI for a single local image source, or `None` to leave it
/// as-is (external, already-inlined, or unreadable).
fn inline_one(url: &str, doc_dir: &Path) -> Option<String> {
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
    let bytes = std::fs::read(&path).ok()?;
    let mime = mime_for(&path);
    let encoded = STANDARD.encode(&bytes);
    Some(format!("data:{mime};base64,{encoded}"))
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        _ => "application/octet-stream",
    }
}

/// Minimal percent-decoding for image paths (handles `%20` etc.). Invalid
/// escapes are passed through literally.
fn percent_decode(input: &str) -> String {
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

/// Wrap rendered body HTML in a full document with a print stylesheet.
fn wrap_document(title: &str, body: &str) -> String {
    format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
         <title>{title}</title>\n<style>{css}</style>\n</head>\n\
         <body class=\"compose-export\">\n{body}\n</body>\n</html>",
        title = escape_html(title),
        css = PRINT_CSS,
        body = body,
    )
}

/// HTML-escape a short plain string (the title). Body HTML is comrak output and
/// must not be re-escaped.
fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Print stylesheet for the exported PDF. Optimized for A4/Letter pages: roomy
/// margins, readable system typography, page-break-aware blocks.
const PRINT_CSS: &str = r#"
@page { margin: 2.4cm 2cm; }
* { box-sizing: border-box; }
body.compose-export {
  margin: 0;
  color: #1a1a1a;
  font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
  font-size: 11.5pt;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.6em; font-weight: 600; page-break-after: avoid; }
h1 { font-size: 1.9em; margin-top: 0; }
h2 { font-size: 1.5em; border-bottom: 1px solid #e2e2e2; padding-bottom: 0.2em; }
h3 { font-size: 1.25em; }
h4 { font-size: 1.05em; }
p, ul, ol, blockquote, table, pre { margin: 0 0 0.9em; }
ul, ol { padding-left: 1.5em; }
li { margin: 0.2em 0; }
a { color: #0b5fff; text-decoration: none; }
strong { font-weight: 600; }
code {
  font-family: "SF Mono", "JetBrains Mono", ui-monospace, "Menlo", monospace;
  font-size: 0.9em;
  background: #f3f3f3;
  padding: 0.12em 0.35em;
  border-radius: 3px;
}
pre {
  background: #f6f8fa;
  border: 1px solid #e2e2e2;
  border-radius: 6px;
  padding: 0.9em 1em;
  overflow-x: auto;
  page-break-inside: avoid;
}
pre code { background: none; padding: 0; font-size: 0.86em; line-height: 1.5; }
blockquote {
  margin-left: 0;
  padding: 0.2em 1em;
  border-left: 3px solid #d0d0d0;
  color: #555;
}
table { border-collapse: collapse; width: 100%; page-break-inside: avoid; }
th, td { border: 1px solid #d8d8d8; padding: 0.45em 0.7em; text-align: left; vertical-align: top; }
th { background: #f3f3f3; font-weight: 600; }
img { max-width: 100%; height: auto; }
hr { border: none; border-top: 1px solid #e2e2e2; margin: 1.6em 0; }
ul.contains-task-list { list-style: none; padding-left: 1em; }
.task-list-item input { margin-right: 0.5em; }
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn doc_dir() -> std::path::PathBuf {
        tempdir().expect("tempdir").keep()
    }

    #[test]
    fn renders_core_gfm_constructs() {
        let md = "# Title\n\nsome **bold** and ~~strike~~.\n\n\
                  | a | b |\n|---|---|\n| 1 | 2 |\n\n- [ ] todo\n- [x] done\n";
        let html = render_markdown_to_html(md, "doc", &doc_dir());
        assert!(html.contains("<h1"));
        assert!(html.contains("<strong>bold</strong>"));
        assert!(html.contains("<del>strike</del>"));
        assert!(html.contains("<table>"));
        assert!(html.contains("type=\"checkbox\""));
        assert!(html.contains("<!doctype html>"));
        assert!(html.contains("<title>doc</title>"));
    }

    #[test]
    fn drops_yaml_frontmatter() {
        let md = "---\ntitle: Secret Meta\ntags: [a, b]\n---\n\n# Body Heading\n";
        let html = render_markdown_to_html(md, "doc", &doc_dir());
        assert!(html.contains("Body Heading"));
        assert!(
            !html.contains("Secret Meta"),
            "frontmatter must not render into the body: {html}"
        );
    }

    #[test]
    fn inlines_local_images_and_leaves_remote_alone() {
        let dir = doc_dir();
        fs::write(dir.join("pic.png"), [0x89, b'P', b'N', b'G', 1, 2, 3]).unwrap();
        let md = "![local](pic.png)\n\n![remote](https://example.com/x.png)\n";
        let html = render_markdown_to_html(md, "doc", &dir);
        assert!(
            html.contains("data:image/png;base64,"),
            "local image should be inlined: {html}"
        );
        assert!(
            html.contains("https://example.com/x.png"),
            "remote image should be left as-is: {html}"
        );
    }

    #[test]
    fn missing_local_image_is_left_untouched_not_fatal() {
        let html = render_markdown_to_html("![x](nope.png)", "doc", &doc_dir());
        assert!(html.contains("nope.png"));
        assert!(!html.contains("data:image"));
    }

    #[test]
    fn percent_decoded_image_path_resolves() {
        let dir = doc_dir();
        fs::create_dir_all(dir.join("my images")).unwrap();
        fs::write(dir.join("my images/p.png"), [1, 2, 3]).unwrap();
        let html = render_markdown_to_html("![x](my%20images/p.png)", "doc", &dir);
        assert!(html.contains("data:image/png;base64,"), "{html}");
    }
}
