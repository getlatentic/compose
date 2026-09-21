//! A clip as a note: the name it is saved under and the Markdown it holds.

const MAX_STEM_CHARS: usize = 80;
const FALLBACK_TITLE: &str = "Clipping";
/// Characters a file name cannot carry on every system a workspace might sync to.
const UNSAFE_IN_FILE_NAMES: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// The file name a title is saved under, without its extension.
pub(super) fn file_stem(title: &str) -> String {
    let cleaned: String = title
        .chars()
        .map(|c| {
            if c.is_control() || UNSAFE_IN_FILE_NAMES.contains(&c) {
                ' '
            } else {
                c
            }
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    // A leading dot hides the file; a trailing dot or space is dropped by some
    // file systems, which then cannot find the name they were given.
    let stem: String = collapsed
        .trim_start_matches('.')
        .chars()
        .take(MAX_STEM_CHARS)
        .collect();
    let stem = stem.trim_end_matches(['.', ' ']);
    if stem.is_empty() {
        FALLBACK_TITLE.to_owned()
    } else {
        stem.to_owned()
    }
}

/// The `attempt`th path to try for a note: `Title.md`, then `Title 2.md`, …
pub(super) fn candidate(stem: &str, attempt: usize) -> String {
    if attempt <= 1 {
        format!("{stem}.md")
    } else {
        format!("{stem} {attempt}.md")
    }
}

/// The note's Markdown. Where a web clip came from is kept as a `source`
/// property, which the Properties panel shows, rather than as prose above the
/// content; the title is a heading unless the content already opens with it.
pub(super) fn compose(title: &str, source: Option<&str>, body: &str, images: &[String]) -> String {
    let title = heading_text(title);
    let body = body.trim();
    let mut sections = Vec::new();
    if let Some(source) = source.map(str::trim).filter(|source| !source.is_empty()) {
        sections.push(format!("---\nsource: {}\n---", yaml_quote(source)));
    }
    if !opens_with_heading(body, &title) {
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
    fn a_title_loses_what_a_file_name_cannot_carry() {
        assert_eq!(file_stem("Proof of Code: Understanding"), "Proof of Code Understanding");
        assert_eq!(file_stem("a/b\\c*d?"), "a b c d");
        assert_eq!(file_stem("  lots   of\tspace\n"), "lots of space");
    }

    #[test]
    fn a_title_cannot_hide_the_file_or_leave_it_nameless() {
        assert_eq!(file_stem("...hidden"), "hidden");
        assert_eq!(file_stem("trailing. "), "trailing");
        assert_eq!(file_stem("://"), "Clipping");
        assert_eq!(file_stem(""), "Clipping");
    }

    #[test]
    fn a_long_title_is_cut_on_a_character_not_a_byte() {
        let stem = file_stem(&"é".repeat(200));
        assert_eq!(stem.chars().count(), MAX_STEM_CHARS);
    }

    #[test]
    fn candidates_count_up_from_the_bare_name() {
        assert_eq!(candidate("Note", 1), "Note.md");
        assert_eq!(candidate("Note", 3), "Note 3.md");
    }

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
