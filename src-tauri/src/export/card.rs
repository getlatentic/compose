//! A note as an image to post: a cover, a quote or a page, at a social
//! network's size. This module builds the card's HTML; [`super::snapshot`]
//! draws it to pixels. The export dialog's preview shows this same HTML, so
//! what the writer sees is what the file holds.

use serde::Deserialize;
use std::path::Path;

use super::typeface::ExportTypefaces;

/// The sizes offered, in pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CardSize {
    /// X / Twitter in-feed, 16:9.
    Landscape,
    /// X and Instagram portrait, 4:5.
    Portrait,
    Square,
    /// Stories and reels, 9:16.
    Story,
    /// LinkedIn and link previews, 1.91:1.
    Wide,
}

impl CardSize {
    pub fn pixels(self) -> (u32, u32) {
        match self {
            Self::Landscape => (1600, 900),
            Self::Portrait => (1080, 1350),
            Self::Square => (1080, 1080),
            Self::Story => (1080, 1920),
            Self::Wide => (1200, 627),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CardLayout {
    Cover,
    Quote,
    Page,
}

/// The words on the card, chosen by the front end from the note.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CardContent {
    /// The small label above the title ("Graduate mathematics").
    pub eyebrow: String,
    pub title: String,
    pub author: String,
    pub subtitle: String,
    pub date: String,
    /// The passage for a quote card.
    pub quote: String,
    /// The note's markdown, for a page card.
    pub body: String,
}

/// The card's colours, resolved from the theme or the writer's background.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardColors {
    pub background: String,
    pub ink: String,
    pub muted: String,
    pub rule: String,
}

/// An image behind the card: the kept note background, softened under the
/// card's colour.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardImage {
    pub file: String,
    pub dim: f64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSpec {
    pub layout: CardLayout,
    pub size: CardSize,
    pub content: CardContent,
    pub colors: CardColors,
    #[serde(default)]
    pub image: Option<CardImage>,
    #[serde(default)]
    pub typefaces: ExportTypefaces,
    /// The small "Compose" mark in the corner.
    #[serde(default = "shows_mark")]
    pub show_mark: bool,
    /// The note the card is drawn from, so a page card's images can be
    /// found beside it.
    #[serde(default)]
    pub document: Option<super::DocumentRef>,
}

fn shows_mark() -> bool {
    true
}

/// `#rrggbb` only: these go straight into the stylesheet.
fn safe_color(value: &str, fallback: &'static str) -> String {
    let valid = value.len() == 7 && value.starts_with('#') && value[1..].chars().all(|ch| ch.is_ascii_hexdigit());
    if valid {
        value.to_owned()
    } else {
        fallback.to_owned()
    }
}

use super::html::escape_html as escape;

/// The image as a data URI, read only from the folder Compose keeps
/// backgrounds in, so a spec cannot pull in an arbitrary file.
fn image_data_uri(file: &str, allowed_dir: Option<&Path>) -> Option<String> {
    let dir = allowed_dir?.canonicalize().ok()?;
    let path = Path::new(file).canonicalize().ok()?;
    if !path.starts_with(&dir) {
        return None;
    }
    crate::image_file::data_uri(&path)
}

/// The card draws only what it carries: the note's images and fonts are
/// inlined, so nothing is fetched from the network or the disk.
const CONTENT_POLICY: &str =
    "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'";
const CARD_CSS: &str = include_str!("card.css");
const CARD_SCRIPT: &str = include_str!("card.js");

/// The card as a complete HTML document of exactly its size in CSS pixels.
pub fn card_html(spec: &CardSpec, backgrounds_dir: Option<&Path>) -> String {
    let (width, height) = spec.size.pixels();
    let typefaces = &spec.typefaces;
    let colors = &spec.colors;
    let background = safe_color(&colors.background, "#f2cf4b");
    let ink = safe_color(&colors.ink, "#1f1d1a");
    let muted = safe_color(&colors.muted, "#4a463f");
    let rule = safe_color(&colors.rule, "#1f1d1a");
    // A hundredth of the shorter side: every size in card.css is a multiple.
    let unit = f64::from(width.min(height)) / 100.0;
    let image_layer = spec
        .image
        .as_ref()
        .and_then(|image| {
            let dim = (image.dim.clamp(0.0, 0.95) * 100.0).round();
            image_data_uri(&image.file, backgrounds_dir).map(|uri| {
                let veil = format!("color-mix(in srgb, {background} {dim}%, transparent)");
                format!("body {{ background-image: linear-gradient({veil}, {veil}), url(\"{uri}\"); background-size: cover; background-position: center; }}")
            })
        })
        .unwrap_or_default();
    let body = match spec.layout {
        CardLayout::Cover => cover(&spec.content),
        CardLayout::Quote => quote(&spec.content),
        CardLayout::Page => page(&spec.content),
    };
    let mark = if spec.show_mark { "<p class=\"mark\">Compose</p>" } else { "" };
    let variables = format!(
        "--card-width: {width}px; --card-height: {height}px; --u: {unit}px; --rule-width: {rule_width}px; \
         --card-bg: {background}; --card-ink: {ink}; --card-muted: {muted}; --card-rule: {rule}; {families}",
        rule_width = (unit * 0.28).max(2.0).round(),
        families = family_vars(typefaces),
    );
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\">\
         <meta http-equiv=\"Content-Security-Policy\" content=\"{CONTENT_POLICY}\">\
         <style>{fonts}\n{CARD_CSS}\n:root {{ {variables} }}\n{image_layer}</style></head>\
         <body><main class=\"card\">{body}</main>{mark}<script>{CARD_SCRIPT}</script></body></html>",
        fonts = typefaces.font_face_css(),
    )
}

/// The three parts' fonts as custom properties the card's rules read.
fn family_vars(typefaces: &ExportTypefaces) -> String {
    let [body, heading, code] = typefaces.stacks();
    format!("--body: {body}; --heading: {heading}; --code: {code};")
}

fn cover(content: &CardContent) -> String {
    let mut html = String::new();
    if !content.eyebrow.trim().is_empty() {
        html.push_str(&format!("<p class=\"eyebrow\">{}</p><div class=\"rule\"></div>", escape(content.eyebrow.trim())));
    }
    html.push_str(&format!("<h1 class=\"title\">{}</h1>", escape(content.title.trim())));
    if !content.author.trim().is_empty() {
        html.push_str(&format!("<p class=\"author\">{}</p>", escape(content.author.trim())));
    }
    html.push_str("<div class=\"spacer\"></div>");
    if !content.subtitle.trim().is_empty() {
        html.push_str(&format!("<div class=\"short-rule\"></div><p class=\"subtitle\">{}</p>", escape(content.subtitle.trim())));
    }
    if !content.date.trim().is_empty() {
        html.push_str(&format!("<p class=\"date\">{}</p>", escape(content.date.trim())));
    }
    html
}

fn quote(content: &CardContent) -> String {
    let credit: Vec<&str> = [content.author.trim(), content.title.trim()].into_iter().filter(|part| !part.is_empty()).collect();
    format!(
        "<div class=\"spacer\"></div><p class=\"quote-mark\">“</p><blockquote class=\"quote\">{}</blockquote>{}<div class=\"spacer\"></div>",
        escape(content.quote.trim()),
        if credit.is_empty() { String::new() } else { format!("<p class=\"credit\">— {}</p>", escape(&credit.join(", "))) },
    )
}

fn page(content: &CardContent) -> String {
    format!("<article class=\"page\">{}</article>", super::html::markdown_fragment(&content.body))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(layout: CardLayout, content: CardContent) -> CardSpec {
        CardSpec {
            layout,
            size: CardSize::Portrait,
            content,
            colors: CardColors { background: "#f2cf4b".into(), ink: "#1f1d1a".into(), muted: "#3d3a35".into(), rule: "#1f1d1a".into() },
            image: None,
            typefaces: ExportTypefaces::default(),
            show_mark: true,
            document: None,
        }
    }

    #[test]
    fn signs_the_card_with_the_compose_mark_unless_asked_not_to() {
        let mut card = spec(CardLayout::Cover, CardContent { title: "T".into(), ..CardContent::default() });
        assert!(card_html(&card, None).contains("<p class=\"mark\">Compose</p>"));
        card.show_mark = false;
        assert!(!card_html(&card, None).contains("class=\"mark\""));
    }

    #[test]
    fn a_page_card_scales_from_the_cards_unit_and_says_when_it_is_ready() {
        let page = card_html(&spec(CardLayout::Page, CardContent { body: "# H\n\n```\ncode\n```".into(), ..CardContent::default() }), None);
        assert!(page.contains("<article class=\"page\">"));
        assert!(page.contains(".page pre {"));
        assert!(page.contains("--u: 10.8px;"));
        assert!(page.contains("dataset.ready"), "every card says when it is ready to draw");
    }

    #[test]
    fn draws_a_page_cards_task_list_as_checkboxes_not_bullets() {
        let page = card_html(&spec(CardLayout::Page, CardContent { body: "- [x] done\n- [ ] open\n\n1. one\n2. two".into(), ..CardContent::default() }), None);
        assert!(page.contains("class=\"contains-task-list\""), "{page}");
        assert!(page.contains("class=\"task-list-item\""));
        assert!(page.contains("checked"));
        // A form control does not inherit the text's size by itself.
        assert!(page.contains("appearance: none; font-size: inherit;"));
        assert!(page.contains(".page ul.contains-task-list { list-style: none;"));
        assert!(page.contains("<ol>"));
    }

    #[test]
    fn a_spec_without_the_mark_field_shows_the_mark() {
        let json = r##"{"layout":"page","size":"portrait","content":{},"colors":{"background":"#ffffff","ink":"#000000","muted":"#555555","rule":"#000000"}}"##;
        let parsed: CardSpec = serde_json::from_str(json).expect("spec");
        assert!(parsed.show_mark);
    }

    #[test]
    fn a_cover_has_the_label_title_author_subtitle_and_year_at_the_cards_size() {
        let content = CardContent {
            eyebrow: "Graduate mathematics".into(),
            title: "A theorem".into(),
            author: "Ada".into(),
            subtitle: "Prime sums".into(),
            date: "2026".into(),
            ..CardContent::default()
        };
        let html = card_html(&spec(CardLayout::Cover, content), None);
        for part in ["Graduate mathematics", "<h1 class=\"title\">A theorem</h1>", "Ada", "Prime sums", "2026"] {
            assert!(html.contains(part), "missing {part}");
        }
        assert!(html.contains("--card-width: 1080px; --card-height: 1350px;"));
        assert!(html.contains("--card-bg: #f2cf4b;"));
    }

    #[test]
    fn leaves_out_what_the_note_does_not_have() {
        let html = card_html(&spec(CardLayout::Cover, CardContent { title: "Only a title".into(), ..CardContent::default() }), None);
        assert!(!html.contains("class=\"eyebrow\""));
        assert!(!html.contains("class=\"subtitle\""));
    }

    #[test]
    fn writes_the_notes_words_as_text_and_refuses_a_colour_that_is_not_one() {
        let mut card = spec(CardLayout::Quote, CardContent { quote: "<script>x</script>".into(), ..CardContent::default() });
        card.colors.background = "red; } body { display:none".into();
        let html = card_html(&card, None);
        assert!(!html.contains("<script>x"));
        assert!(html.contains("&lt;script&gt;x&lt;/script&gt;"));
        assert!(html.contains("--card-bg: #f2cf4b;"));
    }

    #[test]
    fn reads_a_background_image_only_from_the_kept_backgrounds() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let kept = tmp.path().join("backgrounds");
        std::fs::create_dir_all(&kept).expect("dir");
        let inside = kept.join("a.png");
        let outside = tmp.path().join("b.png");
        std::fs::write(&inside, crate::image_file::fixtures::PNG).expect("write");
        std::fs::write(&outside, crate::image_file::fixtures::PNG).expect("write");
        assert!(image_data_uri(&inside.to_string_lossy(), Some(&kept)).is_some());
        assert!(image_data_uri(&outside.to_string_lossy(), Some(&kept)).is_none());
    }

    #[test]
    fn fetches_nothing_from_outside_the_card() {
        let page = card_html(&spec(CardLayout::Page, CardContent { body: "![x](https://tracker.example/p.png)".into(), ..CardContent::default() }), None);
        assert!(page.contains("img-src data:;"), "{page}");
        assert!(page.contains("default-src 'none'"));
    }

    #[test]
    fn every_size_has_its_pixels() {
        assert_eq!(CardSize::Landscape.pixels(), (1600, 900));
        assert_eq!(CardSize::Story.pixels(), (1080, 1920));
    }
}
