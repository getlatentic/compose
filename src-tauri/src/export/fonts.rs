//! Bundled Latin Modern Roman for document exports.
//!
//! The four serif faces are embedded in the binary (`include_bytes!`) and
//! inlined as base64 `@font-face` rules in every exported HTML/PDF, so exports
//! render in Latin Modern — the actively-maintained Computer Modern successor
//! used by modern LaTeX — regardless of what fonts are installed on the machine
//! that opens them.
//!
//! Why Latin Modern over the older CMU (Computer Modern Unicode): the LM faces
//! ship native PostScript/CFF outlines from the GUST e-foundry, preserved
//! losslessly in WOFF2, whereas the common CMU webfonts are FontForge TrueType
//! re-traces with minimal hinting that render thin and uneven. The 10pt optical
//! master (`lmroman10`) is the one LaTeX sets `\normalsize` body text in.
//!
//! Cost model: the PDF embeds only the glyph subset it actually uses, so the
//! PDF stays small. A standalone HTML export carries the full ~190 KB of WOFF2
//! font data — the deliberate price of being self-contained and portable, and
//! the reason we bundle (not CDN-load): a CDN can't serve the PDF generator at
//! render time offline, and would leak a network request from a local-first app.
//!
//! Latin Modern is distributed under the GUST Font License; see
//! `src-tauri/fonts/lmroman/LICENSE.md`.

use std::sync::OnceLock;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

/// CSS family name the export stylesheet selects (see `html::PRINT_CSS`).
pub const FAMILY: &str = "Latin Modern Roman";

const ROMAN: &[u8] = include_bytes!("../../fonts/lmroman/LMRoman10-Regular.woff2");
const BOLD: &[u8] = include_bytes!("../../fonts/lmroman/LMRoman10-Bold.woff2");
const ITALIC: &[u8] = include_bytes!("../../fonts/lmroman/LMRoman10-Italic.woff2");
const BOLD_ITALIC: &[u8] = include_bytes!("../../fonts/lmroman/LMRoman10-BoldItalic.woff2");

/// The four `@font-face` rules embedding Latin Modern Roman as base64 data URIs.
/// Built once and cached — base64-encoding the faces on every export would be
/// wasteful.
pub fn font_face_css() -> &'static str {
    static CSS: OnceLock<String> = OnceLock::new();
    CSS.get_or_init(|| {
        let mut css =
            String::with_capacity(2 * (ROMAN.len() + BOLD.len() + ITALIC.len() + BOLD_ITALIC.len()));
        push_face(&mut css, 400, "normal", ROMAN);
        push_face(&mut css, 700, "normal", BOLD);
        push_face(&mut css, 400, "italic", ITALIC);
        push_face(&mut css, 700, "italic", BOLD_ITALIC);
        css
    })
}

fn push_face(css: &mut String, weight: u16, style: &str, bytes: &[u8]) {
    css.push_str("@font-face{font-family:\"");
    css.push_str(FAMILY);
    css.push_str("\";font-display:swap;font-weight:");
    css.push_str(&weight.to_string());
    css.push_str(";font-style:");
    css.push_str(style);
    css.push_str(";src:url(data:font/woff2;base64,");
    css.push_str(&STANDARD.encode(bytes));
    css.push_str(") format(\"woff2\");}\n");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embeds_four_faces_as_base64() {
        let css = font_face_css();
        assert_eq!(css.matches("@font-face").count(), 4, "{css:.200}");
        assert_eq!(css.matches("font-style:italic").count(), 2);
        assert_eq!(css.matches("font-weight:700").count(), 2);
        assert!(css.contains("data:font/woff2;base64,"));
        assert!(css.contains("font-family:\"Latin Modern Roman\""));
    }
}
