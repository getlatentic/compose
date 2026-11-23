//! Which fonts an export sets the note in: the body text, the headings and the
//! code, as the front end resolves them from the reading font (or Latin
//! Modern, for the LaTeX look).

use serde::Deserialize;

use super::fonts::BundledFace;

/// A font for one part of the note.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Typeface {
    /// Ships with Compose; embedded in the export.
    Bundled { face: BundledFace },
    /// The Mac's own faces (SF Pro, New York, SF Mono), which WebKit reaches
    /// through keywords rather than family names.
    System { font: SystemFont },
    /// Installed on the Mac (Chalkboard, a font the writer added); referred
    /// to by its family name.
    Installed { family: String },
}

/// One of the Mac's own faces.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SystemFont {
    Sans,
    Serif,
    Mono,
}

impl SystemFont {
    fn css(self) -> &'static str {
        match self {
            Self::Sans => "system-ui, -apple-system, sans-serif",
            Self::Serif => "ui-serif, \"New York\", Georgia, serif",
            Self::Mono => "ui-monospace, \"SF Mono\", Menlo, monospace",
        }
    }
}

/// Longer than any real family name; a longer one is refused.
const MAX_FAMILY_LENGTH: usize = 120;

impl Typeface {
    /// A `font-family` value: the face, then a generic fallback.
    fn css(&self, generic: &str) -> String {
        match self {
            Self::Bundled { face } => format!("\"{}\", {}", face.family(), face.generic()),
            Self::System { font } => font.css().to_owned(),
            Self::Installed { family } => format!("{}, {generic}", css_string(family)),
        }
    }

    fn bundled(&self) -> Option<BundledFace> {
        match self {
            Self::Bundled { face } => Some(*face),
            Self::System { .. } | Self::Installed { .. } => None,
        }
    }

    fn is_valid(&self) -> bool {
        match self {
            Self::Bundled { .. } | Self::System { .. } => true,
            Self::Installed { family } => {
                let family = family.trim();
                !family.is_empty() && family.chars().count() <= MAX_FAMILY_LENGTH
            }
        }
    }
}

/// A family name as a CSS string. Characters that could close the string or
/// the stylesheet are escaped as CSS code points.
fn css_string(family: &str) -> String {
    let mut out = String::with_capacity(family.len() + 2);
    out.push('"');
    for ch in family.trim().chars() {
        match ch {
            '"' | '\\' | '<' | '>' => out.push_str(&format!("\\{:x} ", ch as u32)),
            ch if ch.is_control() => {}
            ch => out.push(ch),
        }
    }
    out.push('"');
    out
}

/// The three parts' fonts.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ExportTypefaces {
    pub body: Typeface,
    pub heading: Typeface,
    pub code: Typeface,
}

impl Default for ExportTypefaces {
    /// The LaTeX look: Latin Modern throughout, code in the system monospace.
    fn default() -> Self {
        let latin_modern = Typeface::Bundled { face: BundledFace::LatinModern };
        Self {
            body: latin_modern.clone(),
            heading: latin_modern,
            code: Typeface::System { font: SystemFont::Mono },
        }
    }
}

impl ExportTypefaces {
    /// What a command was sent, or the LaTeX look if it was sent nothing
    /// usable.
    pub fn or_default(requested: Option<Self>) -> Self {
        requested
            .filter(|faces| faces.body.is_valid() && faces.heading.is_valid() && faces.code.is_valid())
            .unwrap_or_default()
    }

    /// The `@font-face` rules for the bundled faces in use, each once.
    pub fn font_face_css(&self) -> String {
        let mut faces: Vec<BundledFace> = Vec::with_capacity(3);
        for face in [&self.body, &self.heading, &self.code].into_iter().filter_map(Typeface::bundled) {
            if !faces.contains(&face) {
                faces.push(face);
            }
        }
        faces.into_iter().map(BundledFace::font_face_css).collect()
    }

    /// The body, heading and code `font-family` values.
    pub fn stacks(&self) -> [String; 3] {
        [self.body.css("serif"), self.heading.css("serif"), self.code.css("monospace")]
    }

    /// The rules that put each part in its font. Appended after the print
    /// stylesheet, so they win over its defaults.
    pub fn family_css(&self) -> String {
        let [body, heading, code] = self.stacks();
        format!(
            "body.compose-export {{ font-family: {body}; }}\n\
             h1, h2, h3, h4, h5, h6 {{ font-family: {heading}; }}\n\
             code, pre, .plain-text {{ font-family: {code}; }}\n"
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn installed(family: &str) -> Typeface {
        Typeface::Installed { family: family.to_owned() }
    }

    #[test]
    fn reads_the_front_ends_shape() {
        let faces: ExportTypefaces = serde_json::from_str(
            r#"{"body":{"kind":"installed","family":"New York"},"heading":{"kind":"bundled","face":"plexSans"},"code":{"kind":"bundled","face":"jetbrainsMono"}}"#,
        )
        .expect("parses");
        assert_eq!(faces.body, installed("New York"));
        assert_eq!(faces.heading, Typeface::Bundled { face: BundledFace::PlexSans });
    }

    #[test]
    fn embeds_each_bundled_face_once_and_names_installed_ones() {
        let faces = ExportTypefaces {
            body: Typeface::Bundled { face: BundledFace::PlexSerif },
            heading: Typeface::Bundled { face: BundledFace::PlexSerif },
            code: installed("Menlo"),
        };
        assert_eq!(faces.font_face_css().matches("font-family:\"IBM Plex Serif\"").count(), 5);
        let css = faces.family_css();
        assert!(css.contains("body.compose-export { font-family: \"IBM Plex Serif\", serif; }"));
        assert!(css.contains("code, pre, .plain-text { font-family: \"Menlo\", monospace; }"));
    }

    #[test]
    fn a_family_name_cannot_break_out_of_the_stylesheet() {
        let css = installed("Evil\"; } body { color: red } </style>").css("serif");
        assert!(!css.contains("</style>"));
        assert!(!css.contains("\"; }"));
        assert!(css.starts_with("\"Evil\\22 ; } body { color: red } \\3c /style\\3e \""));
    }

    #[test]
    fn the_macs_own_faces_resolve_through_webkits_keywords() {
        let serif: Typeface = serde_json::from_str(r#"{"kind":"system","font":"serif"}"#).expect("parses");
        assert_eq!(serif.css("serif"), "ui-serif, \"New York\", Georgia, serif");
        assert!(ExportTypefaces::default().family_css().contains("code, pre, .plain-text { font-family: ui-monospace"));
    }

    #[test]
    fn falls_back_to_the_latex_look_when_sent_nothing_usable() {
        assert_eq!(ExportTypefaces::or_default(None), ExportTypefaces::default());
        let blank = ExportTypefaces { body: installed("  "), heading: installed("X"), code: installed("Y") };
        assert_eq!(ExportTypefaces::or_default(Some(blank)), ExportTypefaces::default());
    }
}
