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

use std::collections::HashMap;
use std::path::Path;

mod images;
mod math;
mod preprocess;
#[cfg(test)]
mod tests;

use super::mermaid::{MermaidRenderer, MERMAID_LANG};
use super::typeface::ExportTypefaces;
pub(in crate::export) use images::inline_local_images;
use math::render_math_to_mathml;
use preprocess::preprocess_markdown;

/// Like [`render_markdown_to_html`], but inlines front-end-rendered mermaid
/// diagrams: `mermaid_svgs` maps a fence's (trimmed) source to its SVG. A fence
/// without an entry degrades to its source as a code block.
pub fn render_markdown_to_html_with_mermaid(
    markdown: &str,
    title: &str,
    doc_dir: &Path,
    mermaid_svgs: HashMap<String, String>,
    typefaces: &ExportTypefaces,
) -> String {
    let body = markdown_to_body(markdown, mermaid_svgs);
    let body = inline_local_images(&body, doc_dir);
    wrap_document(title, &body, typefaces)
}

/// A note's markdown as HTML body content only (no document, no images
/// inlined), for a card that lays it out itself.
pub fn markdown_fragment(markdown: &str) -> String {
    markdown_to_body(markdown, HashMap::new())
}

/// A plain-text document as a standalone page: its text exactly as written,
/// spacing and line breaks kept, nothing read as Markdown.
pub fn render_plain_text_to_html(text: &str, title: &str, typefaces: &ExportTypefaces) -> String {
    wrap_document(title, &format!("<div class=\"plain-text\">{}</div>", escape_html(text)), typefaces)
}

/// comrak GFM render of the body: syntax-highlighted code fences, mermaid fences
/// swapped for their SVG. Frontmatter skipped; raw HTML escaped.
fn markdown_to_body(markdown: &str, mermaid_svgs: HashMap<String, String>) -> String {
    // Syntax-highlight fenced code so the export matches the editor. A
    // `mermaid` fence is intercepted first by the per-language renderer below
    // (it wins over the highlighter), so it becomes its diagram; every other
    // language is highlighted.
    let mermaid = MermaidRenderer::new(mermaid_svgs);
    let mut plugins = comrak::options::Plugins::default();
    plugins.render.codefence_syntax_highlighter = Some(syntect_adapter());
    plugins
        .render
        .codefence_renderers
        .insert(MERMAID_LANG.to_string(), &mermaid);

    let prepared = preprocess_markdown(markdown);
    let html = comrak::markdown_to_html_with_plugins(&prepared, &comrak_options(), &plugins);
    render_math_to_mathml(&html)
}

/// The one comrak configuration — used both to parse for the pre-pass's
/// protected regions and to render, so the two can never disagree on what is
/// code.
fn comrak_options() -> comrak::Options<'static> {
    let mut options = comrak::Options::default();
    options.extension.table = true;
    options.extension.strikethrough = true;
    options.extension.tasklist = true;
    // `contains-task-list` / `task-list-item`, which the export and card
    // stylesheets draw checkboxes from instead of bullets.
    options.render.tasklist_classes = true;
    options.extension.autolink = true;
    options.extension.footnotes = true;
    options.extension.superscript = true;
    // Recognize `$…$` / `$$…$$`. comrak only *tags* the math (for a client-side
    // renderer); `render_math_to_mathml` then typesets it to MathML.
    options.extension.math_dollars = true;
    // Recognize and skip a leading `---\n…\n---` YAML block.
    options.extension.front_matter_delimiter = Some("---".to_string());
    // `render.unsafe_` stays false: raw inline HTML is escaped rather than
    // passed through, so a document can never inject a runnable <script> into
    // the export webview.
    options
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

/// Wrap rendered body HTML in a full document with a print stylesheet, and
/// the fonts the note is set in after it so they win.
fn wrap_document(title: &str, body: &str, typefaces: &ExportTypefaces) -> String {
    format!(
        "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n\
         <title>{title}</title>\n<style>{fonts}{body_css}{css}{families}</style>\n</head>\n\
         <body class=\"compose-export\">\n{body}\n</body>\n</html>",
        title = escape_html(title),
        fonts = typefaces.font_face_css(),
        body_css = BODY_CSS,
        css = PRINT_CSS,
        families = typefaces.family_css(),
        body = body,
    )
}

/// The body rule; its font comes from [`ExportTypefaces::family_css`].
const BODY_CSS: &str = "body.compose-export {\n\
  margin: 0;\n\
  padding: 0;\n\
  color: #1a1a1a;\n\
  font-size: 12pt;\n\
  line-height: 1.5;\n\
  text-rendering: optimizeLegibility;\n\
}\n";

/// HTML-escape plain text: a title, or a plain-text document's body. Markdown
/// body HTML is comrak output and must not be re-escaped.
pub(super) fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
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
  /* Highlighted fences carry the syntect theme's inline background, which a
     stylesheet value always loses to — so the border, not a background, is
     what delimits every code block (including the mermaid source fallback,
     which has no inline background). */
  border: 1px solid #e2e2e2;
  border-radius: 6px;
  padding: 0.9em 1em;
  overflow-x: auto;
  page-break-inside: avoid;
}
pre code { background: none; padding: 0; font-size: 0.86em; line-height: 1.5; }
/* Monospace, so text laid out in columns lines up on paper as it does on screen. */
.plain-text {
  font-family: "SF Mono", "JetBrains Mono", ui-monospace, "Menlo", monospace;
  font-size: 10.5pt;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
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
figure.mermaid-diagram { margin: 0.9em 0; text-align: center; page-break-inside: avoid; }
figure.mermaid-diagram svg { max-width: 100%; height: auto; }
"#;
