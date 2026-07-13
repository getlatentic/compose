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
//! stylesheet, ready to hand to the native paged-output paths (`export::pdf` and
//! `export::print`, both of which paginate it via `export::paged`).

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

/// comrak GFM render of the body, with syntax-highlighted code fences.
/// Frontmatter skipped; raw HTML escaped.
fn markdown_to_body(markdown: &str) -> String {
    let mut options = comrak::Options::default();
    options.extension.table = true;
    options.extension.strikethrough = true;
    options.extension.tasklist = true;
    options.extension.autolink = true;
    options.extension.footnotes = true;
    options.extension.superscript = true;
    // Recognize `$…$` / `$$…$$`. comrak only *tags* the math (for a client-side
    // renderer); `render_math_to_mathml` then typesets it to MathML below.
    options.extension.math_dollars = true;
    // Recognize and skip a leading `---\n…\n---` YAML block.
    options.extension.front_matter_delimiter = Some("---".to_string());
    // `render.unsafe_` stays false: raw inline HTML is escaped rather than
    // passed through, so a document can never inject a runnable <script> into
    // the export webview.

    // Syntax-highlight fenced code so the export matches the editor instead of
    // shipping flat monospace. An unknown fence language (e.g. `mermaid`) falls
    // back to plain text — the diagram itself is a separate concern (#149).
    let mut plugins = comrak::options::Plugins::default();
    plugins.render.codefence_syntax_highlighter = Some(syntect_adapter());

    let prepared = convert_wikilinks_to_links(markdown);
    let html = comrak::markdown_to_html_with_plugins(&prepared, &options, &plugins);
    render_math_to_mathml(&html)
}

/// The syntect highlighter, built once — loading the default syntax + theme
/// sets is not cheap, so it must not be rebuilt per export. `InspiredGitHub` is
/// a light theme from syntect's bundled defaults, matching the export's white
/// page. It MUST stay a real default theme name: the adapter indexes its theme
/// set by name and panics on a miss (the highlight tests exercise this path, so
/// a bad name fails in CI, not in a user's export).
fn syntect_adapter() -> &'static comrak::plugins::syntect::SyntectAdapter {
    use comrak::plugins::syntect::SyntectAdapter;
    use std::sync::OnceLock;
    static ADAPTER: OnceLock<SyntectAdapter> = OnceLock::new();
    ADAPTER.get_or_init(|| SyntectAdapter::new(Some("InspiredGitHub")))
}

/// Typeset the math comrak tagged. comrak's math extension emits
/// `<span data-math-style="inline|display">latex</span>` for `$…$` / `$$…$$`
/// (it expects a client-side renderer). The export has none, so convert each
/// span to MathML, which WebKit typesets natively in the PDF.
fn render_math_to_mathml(html: &str) -> String {
    const OPEN: &str = "<span data-math-style=\"";
    const CLOSE: &str = "</span>";
    let mut out = String::with_capacity(html.len() + 64);
    let mut rest = html;
    while let Some(at) = rest.find(OPEN) {
        out.push_str(&rest[..at]);
        let after = &rest[at + OPEN.len()..];
        match (after.find('"'), after.find('>'), after.find(CLOSE)) {
            (Some(quote), Some(gt), Some(close)) if quote < gt && gt < close => {
                let block = &after[..quote] == "display";
                let escaped_latex = &after[gt + 1..close];
                out.push_str(&latex_to_mathml(escaped_latex, block));
                rest = &after[close + CLOSE.len()..];
            }
            // Not a well-formed math span — emit the tag verbatim, keep scanning.
            _ => {
                out.push_str(OPEN);
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Render one LaTeX equation (HTML-escaped, as comrak emits it) to MathML. On a
/// parse error, fall back to the escaped source so no content is lost.
fn latex_to_mathml(escaped_latex: &str, block: bool) -> String {
    use pulldown_latex::config::DisplayMode;
    use pulldown_latex::{push_mathml, Parser, RenderConfig, Storage};

    let latex = normalize_array_column_specs(&html_unescape(escaped_latex));
    let storage = Storage::new();
    let parser = Parser::new(&latex, &storage);
    let config = RenderConfig {
        display_mode: if block { DisplayMode::Block } else { DisplayMode::Inline },
        ..RenderConfig::default()
    };
    let mut mathml = String::new();
    if push_mathml(&mut mathml, parser, config).is_ok() {
        mathml
    } else {
        format!("<code class=\"math-error\">{escaped_latex}</code>")
    }
}

/// Reverse comrak's HTML escaping so the raw LaTeX reaches the math parser.
fn html_unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

/// Collapse insignificant whitespace inside every `\begin{array}{…}` column
/// spec. pulldown-latex's array parser rejects spaces between column tokens
/// (`{r | r}`, `{l r r}`) that KaTeX and LaTeX itself accept — so without this
/// an otherwise-valid array renders as a parser error instead of a table. Spaces
/// in a column spec carry no meaning, so stripping them is a faithful rewrite.
/// Nested brace groups (`@{…}`, `p{…}`, `*{n}{…}`) keep their contents verbatim.
fn normalize_array_column_specs(latex: &str) -> String {
    const BEGIN: &str = "\\begin{array}";
    let mut out = String::with_capacity(latex.len());
    let mut rest = latex;
    while let Some(at) = rest.find(BEGIN) {
        out.push_str(&rest[..at]);
        out.push_str(BEGIN);
        let after = &rest[at + BEGIN.len()..];
        // The column spec is the next `{…}` group, possibly after whitespace.
        let spec_start = after.trim_start_matches([' ', '\t', '\n', '\r']);
        match (spec_start.starts_with('{')).then(|| take_brace_group(spec_start)).flatten() {
            Some((spec, tail)) => {
                out.push('{');
                out.push_str(&strip_spec_whitespace(spec));
                out.push('}');
                rest = tail;
            }
            // No `{…}` follows (malformed); leave the rest untouched.
            None => rest = after,
        }
    }
    out.push_str(rest);
    out
}

/// Given a string starting with `{`, return the contents of that brace group
/// (excluding the outer braces) and the remainder after the matching `}`.
/// Returns `None` if the braces are unbalanced.
fn take_brace_group(s: &str) -> Option<(&str, &str)> {
    let bytes = s.as_bytes();
    debug_assert_eq!(bytes.first(), Some(&b'{'));
    let mut depth = 0usize;
    for (i, &b) in bytes.iter().enumerate() {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some((&s[1..i], &s[i + 1..]));
                }
            }
            _ => {}
        }
    }
    None
}

/// Remove top-level whitespace from a column spec, preserving the contents of
/// any nested brace group (e.g. `@{ : }`) where spacing can be significant.
fn strip_spec_whitespace(spec: &str) -> String {
    let mut out = String::with_capacity(spec.len());
    let mut depth = 0usize;
    for ch in spec.chars() {
        match ch {
            '{' => {
                depth += 1;
                out.push(ch);
            }
            '}' => {
                depth = depth.saturating_sub(1);
                out.push(ch);
            }
            ' ' | '\t' | '\n' | '\r' if depth == 0 => {}
            _ => out.push(ch),
        }
    }
    out
}

/// Convert `[[target]]` / `[[target|alias]]` into markdown links so the export
/// renders them cleanly (as the editor does) instead of leaving raw `[[…]]`
/// brackets. comrak doesn't understand wikilinks, so we rewrite them to
/// `[alias](<target.md>)` before parsing. Fenced code blocks are skipped so a
/// documented `[[…]]` stays literal.
fn convert_wikilinks_to_links(markdown: &str) -> String {
    let mut out = String::with_capacity(markdown.len());
    let mut in_fence = false;
    for line in markdown.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            out.push_str(line);
        } else if in_fence {
            out.push_str(line);
        } else {
            convert_wikilinks_in_line(line, &mut out);
        }
    }
    out
}

fn convert_wikilinks_in_line(line: &str, out: &mut String) {
    let mut rest = line;
    while let Some(start) = rest.find("[[") {
        out.push_str(&rest[..start]);
        let after_open = &rest[start + 2..];
        let Some(end) = after_open.find("]]") else {
            out.push_str(&rest[start..]);
            return;
        };
        let (target, label) = wikilink_target_and_label(&after_open[..end]);
        if target.is_empty() {
            out.push_str("[[");
            rest = after_open;
            continue;
        }
        // `[label](<href>)` — angle brackets allow spaces in the destination.
        out.push('[');
        out.push_str(label);
        out.push_str("](<");
        out.push_str(&wikilink_href(target));
        out.push_str(">)");
        rest = &after_open[end + 2..];
    }
    out.push_str(rest);
}

/// Mirror of the index crate's `wikilink_target_and_label`.
fn wikilink_target_and_label(body: &str) -> (&str, &str) {
    let mut parts = body.splitn(2, '|');
    let target = parts.next().unwrap_or("").trim();
    let label = parts.next().map(str::trim).filter(|l| !l.is_empty()).unwrap_or(target);
    (target, label)
}

/// Best-effort href for a wikilink target: strip any `#anchor`, ensure `.md`.
fn wikilink_href(target: &str) -> String {
    let base = target.split('#').next().unwrap_or(target).trim().replace('\\', "/");
    if base.to_ascii_lowercase().ends_with(".md") {
        base
    } else {
        format!("{base}.md")
    }
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
         <title>{title}</title>\n<style>{fonts}{body_css}{css}</style>\n</head>\n\
         <body class=\"compose-export\">\n{body}\n</body>\n</html>",
        title = escape_html(title),
        fonts = super::fonts::font_face_css(),
        body_css = body_css(),
        css = PRINT_CSS,
        body = body,
    )
}

/// The body rule, built once. Split from the static `PRINT_CSS` only because the
/// serif `font-family` is owned by `super::fonts` (the bundled face's name).
fn body_css() -> &'static str {
    use std::sync::OnceLock;
    static CSS: OnceLock<String> = OnceLock::new();
    CSS.get_or_init(|| {
        format!(
            "body.compose-export {{\n\
            \x20 margin: 0;\n\
            \x20 padding: 0;\n\
            \x20 color: #1a1a1a;\n\
            \x20 font-family: \"{family}\", Georgia, \"Times New Roman\", serif;\n\
            \x20 font-size: 12pt;\n\
            \x20 line-height: 1.5;\n\
            \x20 text-rendering: optimizeLegibility;\n\
            }}\n",
            family = super::fonts::FAMILY,
        )
    })
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
/* Page geometry. Both native paths (PDF export and Print) paginate through one
   NSPrintOperation, whose NSPrintInfo margins (export::paged::PAGE_MARGIN) define
   the per-page imageable area — so every page gets identical margins and there is
   no empty trailing page. This `@page` margin is kept EQUAL to that value: WebKit
   applies `@page { margin }` on the print path too, and a browser opening a
   standalone HTML export honours it — equal values agree, so margins never
   double. The body carries no padding, so a page margin is never applied
   once-for-the-whole-flow (which is what produced the first-page-only top margin
   and the empty trailing page). */
@page { size: letter; margin: 2cm; }
* { box-sizing: border-box; }
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
math { font-size: 1.05em; }
math[display="block"] { display: block; margin: 0.9em 0; text-align: center; }
.math-error { color: #b22222; }
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
    fn embeds_bundled_serif_font() {
        let html = render_markdown_to_html("hello", "doc", &doc_dir());
        assert!(html.contains("@font-face"), "font faces embedded");
        assert!(
            html.contains("font-family: \"Latin Modern Roman\""),
            "body uses the bundled serif: {html:.400}"
        );
        assert!(html.contains("data:font/woff2;base64,"), "font inlined as data URI");
    }

    #[test]
    fn body_has_no_padding_so_page_margins_stay_consistent() {
        // Page margins come from @page / NSPrintInfo, never body padding (which
        // would apply once to the whole flow → first-page-only top margin + an
        // empty trailing page). Guards against a regression to body padding.
        let html = render_markdown_to_html("hi", "doc", &doc_dir());
        assert!(html.contains("padding: 0;"), "body padding zeroed: {html:.500}");
        assert!(html.contains("@page { size: letter; margin: 2cm; }"), "{html:.500}");
    }

    #[test]
    fn renders_wikilinks_as_links_not_raw_brackets() {
        let html =
            render_markdown_to_html("See [[Daily Note]] and [[plan|the plan]].", "doc", &doc_dir());
        assert!(html.contains(">Daily Note</a>"), "{html}");
        assert!(html.contains(">the plan</a>"), "{html}");
        assert!(!html.contains("[[Daily Note]]"), "raw brackets must be gone: {html}");
    }

    #[test]
    fn leaves_wikilinks_in_fenced_code_alone() {
        let html = render_markdown_to_html("```\n[[Literal]]\n```", "doc", &doc_dir());
        assert!(html.contains("[[Literal]]"), "code-fenced wikilink stays literal: {html}");
    }

    #[test]
    fn typesets_dollar_math_as_mathml() {
        let inline = render_markdown_to_html("mass-energy: $E = mc^2$.", "doc", &doc_dir());
        assert!(inline.contains("<math"), "inline $…$ becomes MathML: {inline:.300}");
        assert!(
            !inline.contains("data-math-style"),
            "the comrak math span is converted, not left raw: {inline:.300}"
        );

        let block = render_markdown_to_html("$$\\frac{a}{b}$$", "doc", &doc_dir());
        assert!(block.contains("<math"), "block $$…$$ becomes MathML: {block:.300}");
        assert!(block.contains("display=\"block\""), "display math uses block: {block:.300}");
    }

    #[test]
    fn renders_array_with_spaced_column_spec_as_a_table() {
        // The textbook writes `{r | r}` with spaces around the pipe; pulldown-latex
        // rejects spaces in a column spec, so this must be normalized to `{r|r}`.
        let md = "$$\n\\begin{array}{r | r}\n2 & 180 \\\\\n\\hline\n& 45\n\\end{array}\n$$";
        let html = render_markdown_to_html(md, "doc", &doc_dir());
        assert!(html.contains("<mtable"), "valid array renders as a MathML table: {html:.400}");
        assert!(!html.contains("merror"), "no parser error for a valid array: {html:.400}");
        assert!(!html.contains("$$"), "the raw $$ delimiters are gone: {html:.400}");
    }

    #[test]
    fn invalid_array_renders_a_graceful_error_not_raw_dollars() {
        // `{2}` is not a valid column spec — a genuine source error. It must
        // degrade to an inline (red) error, never the literal `$$…$$`.
        let md = "$$\n\\begin{array}{2}\na & b \\\\\n\\end{array}\n$$";
        let html = render_markdown_to_html(md, "doc", &doc_dir());
        assert!(!html.contains("$$"), "no raw $$ for an invalid array: {html:.400}");
        // pulldown-latex emits an in-band <merror>; that is the graceful marker.
        assert!(html.contains("merror"), "invalid array shows a math error: {html:.400}");
    }

    #[test]
    fn array_spec_normalization_preserves_nested_brace_content() {
        // Top-level spaces go; spacing inside a nested `@{…}` stays.
        assert_eq!(normalize_array_column_specs("\\begin{array}{r | r}"), "\\begin{array}{r|r}");
        assert_eq!(normalize_array_column_specs("\\begin{array}{l r r}"), "\\begin{array}{lrr}");
        assert_eq!(
            normalize_array_column_specs("\\begin{array}{c @{ : } c}"),
            "\\begin{array}{c@{ : }c}"
        );
        // Non-array braces are untouched.
        assert_eq!(normalize_array_column_specs("\\frac{a b}{c}"), "\\frac{a b}{c}");
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
    fn syntax_highlights_fenced_code() {
        // A known language gets syntect color spans + a theme background on the
        // <pre> — the print/PDF/HTML export no longer ships flat monospace.
        let html = render_markdown_to_html("```rust\nfn main() {}\n```", "doc", &doc_dir());
        assert!(
            html.contains("<span style=\"color:"),
            "fenced code should be syntax-highlighted: {html:.500}"
        );
        assert!(
            html.contains("background-color:"),
            "highlighted <pre> carries a theme background: {html:.500}"
        );
    }

    #[test]
    fn unknown_fence_language_renders_source_without_panicking() {
        // `mermaid` is not a syntect language; it must fall back to plain text
        // (its source), never panic. The diagram rendering is a separate concern.
        let html = render_markdown_to_html("```mermaid\ngraph TD; A-->B\n```", "doc", &doc_dir());
        assert!(html.contains("graph TD"), "unknown-language fence keeps its source: {html:.300}");
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
