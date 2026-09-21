//! What a capture becomes: the text as typed, named after its first line.

use crate::files::new_note;

/// The name a capture gets when its first line gives none.
const FALLBACK_NAME: &str = "Quick note";

/// A capture's title: its first line that says something, without the Markdown
/// that dresses it (a heading's `#`s, a list, task or quote marker).
pub(super) fn title(text: &str) -> Option<String> {
    text.lines()
        .map(without_markup)
        .find(|line| !line.is_empty())
        .map(str::to_owned)
}

fn without_markup(line: &str) -> &str {
    let line = line.trim_start().trim_start_matches('#').trim_start();
    let line = ["- [ ] ", "- [x] ", "- ", "* ", "+ ", "> "]
        .iter()
        .find_map(|marker| line.strip_prefix(marker))
        .unwrap_or(line)
        .trim();
    // A marker with nothing after it, as when a list was only started.
    if matches!(line, "-" | "*" | "+" | ">" | "- [ ]" | "- [x]" | "[ ]" | "[x]") {
        ""
    } else {
        line
    }
}

/// The file name a capture is saved under, without its extension.
pub(super) fn file_stem(text: &str) -> String {
    title(text)
        .and_then(|title| new_note::file_stem(&title))
        .unwrap_or_else(|| FALLBACK_NAME.to_owned())
}

/// What the note holds: the capture as typed, ending in one newline like every
/// file the editor writes.
pub(super) fn content(text: &str) -> String {
    format!("{}\n", text.trim_end())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_first_line_that_says_something_names_the_note() {
        assert_eq!(title("\n\n  Call the printer\nabout the proofs").as_deref(), Some("Call the printer"));
    }

    #[test]
    fn markup_is_not_part_of_the_name() {
        assert_eq!(title("## Book idea").as_deref(), Some("Book idea"));
        assert_eq!(title("- [ ] renew passport").as_deref(), Some("renew passport"));
        assert_eq!(title("> a quote worth keeping").as_deref(), Some("a quote worth keeping"));
        assert_eq!(title("#hashtag").as_deref(), Some("hashtag"));
    }

    #[test]
    fn a_capture_of_nothing_but_markup_has_no_title_but_still_a_name() {
        assert_eq!(title("#\n- \n"), None);
        assert_eq!(file_stem("#\n- \n"), "Quick note");
        assert_eq!(file_stem("???"), "Quick note");
    }

    #[test]
    fn a_name_is_made_safe_for_the_file_system() {
        assert_eq!(file_stem("Q3: plans/ideas"), "Q3 plans ideas");
    }

    #[test]
    fn the_note_keeps_what_was_typed_and_ends_in_one_newline() {
        assert_eq!(content("# Idea\n\nsome **bold** text\n\n\n"), "# Idea\n\nsome **bold** text\n");
        assert_eq!(content("  indented"), "  indented\n");
    }
}
