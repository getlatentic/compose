//! Fonts that ship inside Compose for document exports.
//!
//! An export renders in macOS WebKit, which sees the fonts installed on the
//! Mac and nothing else. The faces below are not installed — Latin Modern is
//! the LaTeX look, and the Plex and JetBrains faces are the app's own reading
//! fonts — so they are embedded in the binary (`include_bytes!`) and inlined as
//! base64 `@font-face` rules in each export that uses them. A PDF keeps only the
//! glyphs it uses; a standalone HTML export carries the whole face, the price
//! of opening the same anywhere, offline, with no network request.
//!
//! Why Latin Modern over the older CMU (Computer Modern Unicode): the LM faces
//! ship native PostScript/CFF outlines from the GUST e-foundry, preserved
//! losslessly in WOFF2, whereas the common CMU webfonts are FontForge TrueType
//! re-traces that render thin and uneven. The 10pt optical master (`lmroman10`)
//! is the one LaTeX sets `\normalsize` body text in.
//!
//! Licences: Latin Modern, GUST Font License (`src-tauri/fonts/lmroman/`);
//! IBM Plex and JetBrains Mono, SIL Open Font License 1.1 (each folder's
//! `LICENSE`).

use std::sync::OnceLock;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Deserialize;

/// A face bundled with Compose, as the front end names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BundledFace {
    LatinModern,
    PlexSerif,
    PlexSans,
    JetbrainsMono,
}

/// One embedded file of a face: its weight (a range for a variable font),
/// style and bytes.
struct FaceFile {
    weight: &'static str,
    style: &'static str,
    bytes: &'static [u8],
}

impl BundledFace {
    /// The CSS family name its `@font-face` rules declare.
    pub fn family(self) -> &'static str {
        match self {
            Self::LatinModern => "Latin Modern Roman",
            Self::PlexSerif => "IBM Plex Serif",
            Self::PlexSans => "IBM Plex Sans",
            Self::JetbrainsMono => "JetBrains Mono",
        }
    }

    /// The generic family a reader's system falls back to if the face fails.
    pub fn generic(self) -> &'static str {
        match self {
            Self::LatinModern | Self::PlexSerif => "serif",
            Self::PlexSans => "sans-serif",
            Self::JetbrainsMono => "monospace",
        }
    }

    fn files(self) -> &'static [FaceFile] {
        match self {
            Self::LatinModern => &[
                FaceFile { weight: "400", style: "normal", bytes: include_bytes!("../../fonts/lmroman/LMRoman10-Regular.woff2") },
                FaceFile { weight: "700", style: "normal", bytes: include_bytes!("../../fonts/lmroman/LMRoman10-Bold.woff2") },
                FaceFile { weight: "400", style: "italic", bytes: include_bytes!("../../fonts/lmroman/LMRoman10-Italic.woff2") },
                FaceFile { weight: "700", style: "italic", bytes: include_bytes!("../../fonts/lmroman/LMRoman10-BoldItalic.woff2") },
            ],
            Self::PlexSerif => &[
                FaceFile { weight: "400", style: "normal", bytes: include_bytes!("../../fonts/plex-serif/ibm-plex-serif-latin-400-normal.woff2") },
                FaceFile { weight: "400", style: "italic", bytes: include_bytes!("../../fonts/plex-serif/ibm-plex-serif-latin-400-italic.woff2") },
                FaceFile { weight: "600", style: "normal", bytes: include_bytes!("../../fonts/plex-serif/ibm-plex-serif-latin-600-normal.woff2") },
                FaceFile { weight: "700", style: "normal", bytes: include_bytes!("../../fonts/plex-serif/ibm-plex-serif-latin-700-normal.woff2") },
                FaceFile { weight: "700", style: "italic", bytes: include_bytes!("../../fonts/plex-serif/ibm-plex-serif-latin-700-italic.woff2") },
            ],
            Self::PlexSans => &[
                FaceFile { weight: "100 700", style: "normal", bytes: include_bytes!("../../fonts/plex-sans/ibm-plex-sans-latin-wght-normal.woff2") },
                FaceFile { weight: "100 700", style: "italic", bytes: include_bytes!("../../fonts/plex-sans/ibm-plex-sans-latin-wght-italic.woff2") },
            ],
            Self::JetbrainsMono => &[
                FaceFile { weight: "100 800", style: "normal", bytes: include_bytes!("../../fonts/jetbrains-mono/jetbrains-mono-latin-wght-normal.woff2") },
                FaceFile { weight: "100 800", style: "italic", bytes: include_bytes!("../../fonts/jetbrains-mono/jetbrains-mono-latin-wght-italic.woff2") },
            ],
        }
    }

    /// The face's `@font-face` rules, base64-encoded once and kept.
    pub fn font_face_css(self) -> &'static str {
        static LATIN_MODERN: OnceLock<String> = OnceLock::new();
        static PLEX_SERIF: OnceLock<String> = OnceLock::new();
        static PLEX_SANS: OnceLock<String> = OnceLock::new();
        static JETBRAINS_MONO: OnceLock<String> = OnceLock::new();
        let cache = match self {
            Self::LatinModern => &LATIN_MODERN,
            Self::PlexSerif => &PLEX_SERIF,
            Self::PlexSans => &PLEX_SANS,
            Self::JetbrainsMono => &JETBRAINS_MONO,
        };
        cache.get_or_init(|| {
            let mut css = String::new();
            for file in self.files() {
                push_face(&mut css, self.family(), file);
            }
            css
        })
    }
}

fn push_face(css: &mut String, family: &str, file: &FaceFile) {
    css.push_str("@font-face{font-family:\"");
    css.push_str(family);
    css.push_str("\";font-display:swap;font-weight:");
    css.push_str(file.weight);
    css.push_str(";font-style:");
    css.push_str(file.style);
    css.push_str(";src:url(data:font/woff2;base64,");
    css.push_str(&STANDARD.encode(file.bytes));
    css.push_str(") format(\"woff2\");}\n");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embeds_latin_modern_in_four_faces() {
        let css = BundledFace::LatinModern.font_face_css();
        assert_eq!(css.matches("@font-face").count(), 4, "{css:.200}");
        assert_eq!(css.matches("font-style:italic").count(), 2);
        assert_eq!(css.matches("font-weight:700").count(), 2);
        assert!(css.contains("data:font/woff2;base64,"));
        assert!(css.contains("font-family:\"Latin Modern Roman\""));
    }

    #[test]
    fn a_variable_face_declares_its_weight_range() {
        let css = BundledFace::PlexSans.font_face_css();
        assert_eq!(css.matches("@font-face").count(), 2);
        assert!(css.contains("font-family:\"IBM Plex Sans\";font-display:swap;font-weight:100 700;font-style:normal"));
    }

    #[test]
    fn each_face_caches_its_own_rules() {
        assert!(BundledFace::PlexSerif.font_face_css().contains("IBM Plex Serif"));
        assert!(BundledFace::JetbrainsMono.font_face_css().contains("JetBrains Mono"));
        assert!(!BundledFace::PlexSerif.font_face_css().contains("JetBrains"));
    }
}
