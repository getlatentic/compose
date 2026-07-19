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
        meta: &str,
        code: &str,
        _sourcepos: Option<Sourcepos>,
    ) -> fmt::Result {
        // The editor treats only a bare `mermaid` info string as a diagram
        // (`/^mermaid\s*$/i`); a fence with trailing meta ("mermaid title=x")
        // shows as source there, so it must export as source too.
        let svg = if meta.trim().is_empty() { self.svgs.get(code.trim()) } else { None };
        match svg {
            // The SVG is produced by the front end's mermaid with
            // `securityLevel: "strict"` (no scripts, escaped labels) — the same
            // output the editor already inlines via innerHTML — so it is inlined
            // here directly, matching that trust boundary.
            Some(svg) => write!(output, "<figure class=\"mermaid-diagram\">{svg}</figure>\n"),
            None => {
                output.write_str("<pre><code class=\"language-mermaid\">")?;
                // comrak's own escaper (covers `"` and NUL as well), since its
                // default escaping is bypassed once a codefence renderer takes
                // over.
                comrak::html::escape(output, code)?;
                output.write_str("</code></pre>\n")
            }
        }
    }
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
