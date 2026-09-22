//! A clip as a note: the Markdown it holds.

/// What a clip is called when nothing it came with names it.
pub(super) const FALLBACK_TITLE: &str = "Clipping";

/// The note's Markdown. Where a web clip came from is kept as a `source`
/// property, which the Properties panel shows, rather than as prose above the
/// content. The title is a heading unless the content already opens with it,
/// and text whose first line is the title has that line made the heading.
pub(super) fn compose(title: &str, source: Option<&str>, body: &str, images: &[String]) -> String {
    let title = heading_text(title);
    let mut body = body.trim();
    let mut sections = Vec::new();
    if let Some(source) = source.map(str::trim).filter(|source| !source.is_empty()) {
        sections.push(format!("---\nsource: {}\n---", yaml_quote(source)));
    }
    if !opens_with_heading(body, &title) {
        body = after_first_line_if(body, &title).unwrap_or(body);
        sections.push(format!("# {title}"));
    }
    if !body.is_empty() {
        sections.push(body.to_owned());
    }
    sections.extend(images.iter().map(|path| format!("![{}]({path})", alt_text(path))));
    let mut note = sections.join("\n\n");
    note.push('\n');
    note
}

fn heading_text(title: &str) -> String {
    let text = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        FALLBACK_TITLE.to_owned()
    } else {
        text
    }
}

/// What follows `body`'s first line when that line says `title`.
fn after_first_line_if<'a>(body: &'a str, title: &str) -> Option<&'a str> {
    let (first, rest) = body.split_once('\n').unwrap_or((body, ""));
    (heading_text(first) == title).then(|| rest.trim())
}

fn opens_with_heading(body: &str, title: &str) -> bool {
    let Some(first) = body.lines().map(str::trim).find(|line| !line.is_empty()) else {
        return false;
    };
    let hashes = first.chars().take_while(|&c| c == '#').count();
    (1..=6).contains(&hashes) && first[hashes..].trim() == title
}

/// What an image is called when it cannot be shown: its file name, without the
/// position the extension prefixed to keep names apart.
fn alt_text(path: &str) -> String {
    let file = path.rsplit('/').next().unwrap_or(path);
    let stem = file.rsplit_once('.').map_or(file, |(stem, _)| stem);
    let unnumbered = stem
        .split_once('-')
        .filter(|(position, _)| !position.is_empty() && position.chars().all(|c| c.is_ascii_digit()))
        .map_or(stem, |(_, rest)| rest);
    if unnumbered.is_empty() {
        "image".to_owned()
    } else {
        unnumbered.to_owned()
    }
}

fn yaml_quote(value: &str) -> String {
    let escaped: String = value
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    format!("\"{escaped}\"")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_web_clip_keeps_its_source_as_a_property() {
        let note = compose("Title", Some("https://x.dev/a?b=\"c\""), "Body.", &[]);
        assert_eq!(note, "---\nsource: \"https://x.dev/a?b=\\\"c\\\"\"\n---\n\n# Title\n\nBody.\n");
    }

    #[test]
    fn text_without_a_source_has_no_properties() {
        assert_eq!(compose("Title", None, "  Body.\n", &[]), "# Title\n\nBody.\n");
    }

    #[test]
    fn content_that_opens_with_the_title_is_not_titled_twice() {
        let note = compose("Title", None, "## Title\n\nBody.", &[]);
        assert_eq!(note, "## Title\n\nBody.\n");
    }

    #[test]
    fn text_whose_first_line_is_the_title_is_not_titled_twice() {
        assert_eq!(compose("Buy milk", None, "Buy  milk\nand eggs", &[]), "# Buy milk\n\nand eggs\n");
        assert_eq!(compose("Buy milk", None, "Buy milk", &[]), "# Buy milk\n");
        assert_eq!(compose("Groceries", None, "Buy milk", &[]), "# Groceries\n\nBuy milk\n");
    }

    #[test]
    fn images_follow_the_content_named_after_their_files() {
        let images = ["images/1-shot.png".to_owned(), "images/2-.jpg".to_owned()];
        assert_eq!(
            compose("T", None, "", &images),
            "# T\n\n![shot](images/1-shot.png)\n\n![image](images/2-.jpg)\n"
        );
    }

    #[test]
    fn an_empty_title_still_heads_the_note() {
        assert_eq!(compose(" \n", None, "Body.", &[]), "# Clipping\n\nBody.\n");
    }
}
