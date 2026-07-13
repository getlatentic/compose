//! Mermaid fences in the export → the frontend's rendered SVG, inlined.
//!
//! There is no Rust mermaid renderer, so the diagrams are rasterised to SVG on
//! the front end (the same `mermaid` the editor uses) and handed to the export
//! commands as a `{ source → svg }` map. This comrak codefence renderer swaps a
//! ```mermaid block for its SVG; a fence with no supplied SVG (the render
//! failed, or the map is stale) degrades to the source as a plain code block —
//! never a blank.
//!
//! Keyed on the fence source **trimmed** on both ends: comrak hands the adapter
//! the fence literal with a trailing newline, and the front end keys on the
//! trimmed diagram text, so the two agree without depending on exact whitespace.

use std::collections::HashMap;
use std::fmt;

use comrak::adapters::CodefenceRendererAdapter;
use comrak::nodes::Sourcepos;

/// The info-string language token this renderer is registered under.
pub const MERMAID_LANG: &str = "mermaid";

pub struct MermaidRenderer {
    /// Diagram source (trimmed) → rendered SVG.
    svgs: HashMap<String, String>,
}

impl MermaidRenderer {
    pub fn new(svgs: HashMap<String, String>) -> Self {
        Self {
            svgs: svgs.into_iter().map(|(k, v)| (k.trim().to_string(), v)).collect(),
        }
    }
}

impl CodefenceRendererAdapter for MermaidRenderer {
    fn write(
        &self,
        output: &mut dyn fmt::Write,
        _lang: &str,
        _meta: &str,
        code: &str,
        _sourcepos: Option<Sourcepos>,
    ) -> fmt::Result {
        match self.svgs.get(code.trim()) {
            // The SVG is produced by the front end's mermaid with
            // `securityLevel: "strict"` (no scripts, escaped labels) — the same
            // output the editor already inlines via innerHTML — so it is inlined
            // here directly, matching that trust boundary.
            Some(svg) => write!(output, "<figure class=\"mermaid-diagram\">{svg}</figure>\n"),
            None => write!(
                output,
                "<pre><code class=\"language-mermaid\">{}</code></pre>\n",
                escape_html_text(code)
            ),
        }
    }
}

/// Escape a fence body for the fallback code block (comrak's default escaping is
/// bypassed once a codefence renderer takes over, so do it here).
fn escape_html_text(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render(renderer: &MermaidRenderer, code: &str) -> String {
        let mut out = String::new();
        renderer.write(&mut out, MERMAID_LANG, "", code, None).unwrap();
        out
    }

    #[test]
    fn inlines_the_supplied_svg_for_a_matching_fence() {
        let mut svgs = HashMap::new();
        svgs.insert("flowchart TD\n  A --> B".to_string(), "<svg id=\"x\"></svg>".to_string());
        let renderer = MermaidRenderer::new(svgs);
        // comrak passes the fence body with a trailing newline; trimming aligns it.
        let html = render(&renderer, "flowchart TD\n  A --> B\n");
        assert!(html.contains("<figure class=\"mermaid-diagram\"><svg id=\"x\"></svg>"), "{html}");
    }

    #[test]
    fn falls_back_to_an_escaped_source_block_when_no_svg() {
        let renderer = MermaidRenderer::new(HashMap::new());
        let html = render(&renderer, "graph LR\n  A --> <b>\n");
        assert!(html.contains("<pre><code class=\"language-mermaid\">"), "{html}");
        assert!(html.contains("graph LR"), "keeps the source: {html}");
        assert!(html.contains("&lt;b&gt;"), "escapes the source: {html}");
        assert!(!html.contains("<figure"), "no diagram figure without an svg: {html}");
    }
}
