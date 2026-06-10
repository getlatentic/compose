//! Bundled Computer Modern (CMU Serif) for document exports.
//!
//! The four serif faces are embedded in the binary (`include_bytes!`) and
//! inlined as base64 `@font-face` rules in every exported HTML/PDF, so exports
//! render in Computer Modern — the classic LaTeX/academic serif — regardless of
//! what fonts are installed on the machine that opens them.
//!
//! Cost model: the PDF embeds only the glyph subset it actually uses, so the
//! PDF stays small. A standalone HTML export carries the full ~390 KB of WOFF2
//! font data — the deliberate price of being self-contained and portable, and
//! the reason we bundle (not CDN-load): a CDN can't serve the PDF generator at
//! render time offline, and would leak a network request from a local-first app.
//!
//! CMU (Computer Modern Unicode, by Andrey V. Panov) is freely redistributable;
//! see `src-tauri/fonts/cmu/LICENSE.md`.

use std::sync::OnceLock;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;

const ROMAN: &[u8] = include_bytes!("../../fonts/cmu/CMU-Serif-Roman.woff2");
const BOLD: &[u8] = include_bytes!("../../fonts/cmu/CMU-Serif-Bold.woff2");
const ITALIC: &[u8] = include_bytes!("../../fonts/cmu/CMU-Serif-Italic.woff2");
const BOLD_ITALIC: &[u8] = include_bytes!("../../fonts/cmu/CMU-Serif-BoldItalic.woff2");

/// The four `@font-face` rules embedding CMU Serif as base64 data URIs. Built
/// once and cached — base64-encoding ~1 MB on every export would be wasteful.
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
    css.push_str("@font-face{font-family:\"CMU Serif\";font-display:swap;font-weight:");
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
    }
}
