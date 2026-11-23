//! A note as an image to post: a cover, a quote or a page, at a social
//! network's size. This module builds the card's HTML; [`super::snapshot`]
//! draws it to pixels. The export dialog's preview shows this same HTML, so
//! what the writer sees is what the file holds.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
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
    pub typefaces: Option<ExportTypefaces>,
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

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// The image as a data URI, read only from the folder Compose keeps
/// backgrounds in, so a spec cannot pull in an arbitrary file.
fn image_data_uri(file: &str, allowed_dir: Option<&Path>) -> Option<String> {
    let dir = allowed_dir?.canonicalize().ok()?;
    let path = Path::new(file).canonicalize().ok()?;
    if !path.starts_with(&dir) {
        return None;
    }
    let mime = match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => return None,
    };
    let bytes = std::fs::read(&path).ok()?;
    Some(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

/// The card as a complete HTML document of exactly its size in CSS pixels.
pub fn card_html(spec: &CardSpec, backgrounds_dir: Option<&Path>) -> String {
    let (width, height) = spec.size.pixels();
    let typefaces = ExportTypefaces::or_default(spec.typefaces.clone());
    let colors = &spec.colors;
    let background = safe_color(&colors.background, "#f2cf4b");
    let ink = safe_color(&colors.ink, "#1f1d1a");
    let muted = safe_color(&colors.muted, "#4a463f");
    let rule = safe_color(&colors.rule, "#1f1d1a");
    // Type scales with the card's shorter side, so every size keeps the look.
    let unit = f64::from(width.min(height)) / 100.0;
    let image_layer = spec
        .image
        .as_ref()
        .and_then(|image| {
            let dim = (image.dim.clamp(0.0, 0.95) * 100.0).round();
            image_data_uri(&image.file, backgrounds_dir)
                .map(|uri| format!("background-image: linear-gradient(color-mix(in srgb, {background} {dim}%, transparent), color-mix(in srgb, {background} {dim}%, transparent)), url(\"{uri}\"); background-size: cover; background-position: center;"))
        })
        .unwrap_or_default();

    let body = match spec.layout {
        CardLayout::Cover => cover(&spec.content),
        CardLayout::Quote => quote(&spec.content),
        CardLayout::Page => page(&spec.content),
    };

    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><style>
{fonts}
* {{ box-sizing: border-box; margin: 0; }}
html, body {{ width: {width}px; height: {height}px; overflow: hidden; }}
body {{ background: {background}; {image_layer} color: {ink}; -webkit-font-smoothing: antialiased; }}
.card {{ position: absolute; inset: 0; display: flex; flex-direction: column; padding: {pad}px; }}
.eyebrow {{ font-family: system-ui, -apple-system, sans-serif; font-weight: 700; font-size: {eyebrow}px; letter-spacing: 0.08em; text-transform: uppercase; }}
.rule {{ height: {rule_w}px; background: {rule}; margin: {gap}px 0 {gap2}px; }}
.title {{ font-family: var(--body); font-weight: 700; font-size: {title}px; line-height: 1.12; letter-spacing: -0.01em; }}
.author {{ font-family: var(--body); font-size: {author}px; color: {muted}; margin-top: {gap}px; }}
.spacer {{ flex: 1; }}
.short-rule {{ width: 22%; height: {rule_w}px; background: {rule}; margin-bottom: {gap}px; }}
.subtitle {{ font-family: var(--body); font-style: italic; font-size: {author}px; color: {muted}; }}
.date {{ font-family: system-ui, -apple-system, sans-serif; font-size: {small}px; color: {muted}; margin-top: {gap}px; }}
.quote-mark {{ font-family: var(--body); font-size: {mark}px; line-height: 0.8; color: {rule}; }}
.quote {{ font-family: var(--body); font-size: {quote}px; line-height: 1.3; }}
.credit {{ font-family: system-ui, -apple-system, sans-serif; font-size: {small}px; color: {muted}; letter-spacing: 0.04em; margin-top: {gap}px; }}
.page {{ --fit: 1; flex: 1; min-height: 0; overflow: hidden; }}
.page.overflowing {{ -webkit-mask-image: linear-gradient(#000 85%, transparent); }}
.page h1, .page h2, .page h3, .page h4 {{ font-family: var(--heading); line-height: 1.2; margin: 0 0 calc({gap}px * var(--fit)); }}
.page h1 {{ font-size: calc({page_h1}px * var(--fit)); }}
.page h2 {{ font-size: calc({page_h2}px * var(--fit)); }}
.page h3, .page h4 {{ font-size: calc({page_h3}px * var(--fit)); }}
.page p, .page li, .page blockquote, .page td, .page th {{ font-family: var(--body); font-size: calc({page_body}px * var(--fit)); line-height: 1.5; margin: 0 0 calc({gap}px * var(--fit)); }}
.page ul, .page ol {{ margin: 0 0 calc({gap}px * var(--fit)); padding-left: calc({page_body}px * var(--fit) * 1.8); }}
.page li > p {{ margin: 0; }}
.page ul.contains-task-list {{ list-style: none; padding-left: 0; }}
.page .task-list-item {{ display: flex; align-items: baseline; gap: 0.55em; }}
.page .task-list-item input {{ -webkit-appearance: none; appearance: none; font-size: inherit; flex: none; width: 0.85em; height: 0.85em; margin: 0; position: relative; top: 0.1em; border: max(2px, 0.09em) solid {ink}; border-radius: 0.2em; }}
.page .task-list-item input:checked {{ background: {ink}; }}
.page .task-list-item input:checked::after {{ content: ""; position: absolute; left: 0.24em; top: 0.06em; width: 0.2em; height: 0.42em; border: solid {background}; border-width: 0 0.1em 0.1em 0; transform: rotate(45deg); }}
.page img {{ display: block; max-width: 100%; max-height: 60%; margin: 0 0 calc({gap}px * var(--fit)); border-radius: 0.3em; }}
.page blockquote {{ padding-left: 0.8em; border-left: {rule_w}px solid {rule}; color: {muted}; }}
.page code {{ font-family: var(--code); font-size: 0.88em; }}
.page pre {{ font-family: var(--code); font-size: calc({page_code}px * var(--fit)); line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 calc({gap}px * var(--fit)); padding: 0.8em 1em; border-radius: 0.4em; background: color-mix(in srgb, {ink} 6%, transparent); }}
.page pre code {{ font-size: 1em; }}
.mark {{ position: absolute; right: {pad}px; bottom: calc({pad}px * 0.55); font-family: system-ui, -apple-system, sans-serif; font-weight: 600; font-size: {mark_size}px; letter-spacing: 0.02em; color: {muted}; opacity: 0.75; }}
:root {{ {families} }}
</style></head><body><main class="card">{body}</main>{compose_mark}{fit}</body></html>"#,
        fonts = typefaces.font_face_css(),
        families = family_vars(&typefaces),
        pad = (unit * 7.0).round(),
        eyebrow = (unit * 2.4).round(),
        rule_w = (unit * 0.28).max(2.0).round(),
        gap = (unit * 2.6).round(),
        gap2 = (unit * 7.0).round(),
        title = (unit * 9.0).round(),
        author = (unit * 3.4).round(),
        small = (unit * 2.2).round(),
        mark = (unit * 16.0).round(),
        quote = (unit * 5.6).round(),
        page_h1 = (unit * 5.4).round(),
        page_h2 = (unit * 4.2).round(),
        page_h3 = (unit * 3.4).round(),
        page_body = (unit * 2.9).round(),
        page_code = (unit * 2.4).round(),
        mark_size = (unit * 1.9).round(),
        compose_mark = if spec.show_mark { "<p class=\"mark\">Compose</p>" } else { "" },
        fit = if spec.layout == CardLayout::Page { FIT_PAGE_SCRIPT } else { "" },
    )
}

/// Grows a page card's text to fill the card: the largest `--fit` from 1 to
/// 2.2 at which the note still fits. A note that does not fit even at
/// 1 keeps that size and fades out at the bottom. Runs again once the
/// embedded fonts have loaded, since they change the text's height.
const FIT_PAGE_SCRIPT: &str = r#"<script>
(function () {
  var page = document.querySelector(".page");
  if (!page) return;
  function fits(scale) {
    page.style.setProperty("--fit", String(scale));
    return page.scrollHeight <= page.clientHeight + 1;
  }
  function fit() {
    var low = 1, high = 2.2;
    if (!fits(low)) { page.classList.add("overflowing"); return; }
    page.classList.remove("overflowing");
    for (var i = 0; i < 12; i++) {
      var mid = (low + high) / 2;
      if (fits(mid)) low = mid; else high = mid;
    }
    fits(low);
  }
  fit();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
})();
</script>"#;

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
            typefaces: None,
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
    fn fits_only_a_page_card_to_its_size_and_gives_its_code_a_size_of_its_own() {
        let page = card_html(&spec(CardLayout::Page, CardContent { body: "# H\n\n```\ncode\n```".into(), ..CardContent::default() }), None);
        assert!(page.contains("document.querySelector(\".page\")"));
        assert!(page.contains(".page pre {"));
        assert!(page.contains("calc(26px * var(--fit))"));
        let cover = card_html(&spec(CardLayout::Cover, CardContent { title: "T".into(), ..CardContent::default() }), None);
        assert!(!cover.contains("<script>"));
    }

    #[test]
    fn draws_a_page_cards_task_list_as_checkboxes_not_bullets() {
        let page = card_html(&spec(CardLayout::Page, CardContent { body: "- [x] done\n- [ ] open\n\n1. one\n2. two".into(), ..CardContent::default() }), None);
        assert!(page.contains("class=\"contains-task-list\""), "{page}");
        assert!(page.contains("class=\"task-list-item\""));
        assert!(page.contains("checked"));
        // A form control does not inherit the text's size by itself.
        assert!(page.contains("appearance: none; font-size: inherit;"));
        assert!(page.contains(".page ul.contains-task-list {{ list-style: none;".replace("{{", "{").as_str()));
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
        assert!(html.contains("width: 1080px; height: 1350px;"));
        assert!(html.contains("background: #f2cf4b;"));
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
        assert!(html.contains("background: #f2cf4b;"));
    }

    #[test]
    fn reads_a_background_image_only_from_the_kept_backgrounds() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let kept = tmp.path().join("backgrounds");
        std::fs::create_dir_all(&kept).expect("dir");
        let inside = kept.join("a.png");
        let outside = tmp.path().join("b.png");
        std::fs::write(&inside, b"png").expect("write");
        std::fs::write(&outside, b"png").expect("write");
        assert!(image_data_uri(&inside.to_string_lossy(), Some(&kept)).is_some());
        assert!(image_data_uri(&outside.to_string_lossy(), Some(&kept)).is_none());
    }

    #[test]
    fn every_size_has_its_pixels() {
        assert_eq!(CardSize::Landscape.pixels(), (1600, 900));
        assert_eq!(CardSize::Story.pixels(), (1080, 1920));
    }
}
