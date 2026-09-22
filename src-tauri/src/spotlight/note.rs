//! A note as Spotlight holds it: its title, the opening of its text to show
//! under a result, and its text to search.

use std::path::Path;

use crate::db::{content_hash_bytes, IndexableDocument};
use crate::files::icloud;
use crate::workspace::WorkspaceRecord;

/// Past this, the rest of a note is left unsearched rather than held in memory
/// and handed to Spotlight.
const MOST_TEXT: usize = 256 * 1024;
const SUMMARY_CHARS: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct SearchableNote {
    /// The note's absolute path: what a result opens.
    pub id: String,
    pub workspace_id: String,
    pub workspace_name: String,
    pub relative_path: String,
    /// Of what was read, which may be newer than what the store has seen.
    pub content_hash: String,
    pub title: String,
    pub summary: String,
    pub text: String,
    /// Milliseconds since the epoch.
    pub modified_at: i64,
}

/// `document` read from `workspace`, or `None` for a note not on this Mac — an
/// iCloud placeholder, which reading would download — or one that cannot be
/// read now. A later pass picks either up.
pub(super) fn read(workspace: &WorkspaceRecord, document: &IndexableDocument) -> Option<SearchableNote> {
    let path = Path::new(&workspace.path).join(&document.relative_path);
    if icloud::is_dataless(&path) {
        return None;
    }
    let bytes = std::fs::read(&path).ok()?;
    let markdown = String::from_utf8_lossy(&bytes);
    let text = body(&markdown);
    Some(SearchableNote {
        id: path.to_string_lossy().into_owned(),
        workspace_id: workspace.id.clone(),
        workspace_name: workspace.name.clone(),
        relative_path: document.relative_path.clone(),
        content_hash: content_hash_bytes(&bytes),
        title: document.title.clone(),
        summary: summary(text),
        text: prefix(text, MOST_TEXT).to_owned(),
        modified_at: document.modified_at,
    })
}

/// The note without its front matter.
fn body(markdown: &str) -> &str {
    let Some(rest) = markdown.strip_prefix("---\n").or_else(|| markdown.strip_prefix("---\r\n")) else {
        return markdown;
    };
    rest.find("\n---")
        .and_then(|end| rest[end + 4..].split_once('\n').map(|(_, after)| after).or(Some("")))
        .unwrap_or(markdown)
}

/// The first paragraph that says something, as plain text: what a result shows
/// under the title, which headings would only repeat.
fn summary(body: &str) -> String {
    let paragraph = body
        .split("\n\n")
        .map(str::trim)
        .find(|paragraph| !paragraph.is_empty() && !paragraph.starts_with('#') && !plain(paragraph).is_empty())
        .unwrap_or("");
    let text = plain(paragraph);
    match text.char_indices().nth(SUMMARY_CHARS) {
        Some((cut, _)) => format!("{}…", text[..cut].trim_end()),
        None => text,
    }
}

/// Markdown as the words it shows: marks, list bullets and link targets gone,
/// lines joined, images left out.
fn plain(markdown: &str) -> String {
    let mut words = Vec::new();
    for line in markdown.lines() {
        let line = line.trim_start_matches(|c: char| c == '>' || c.is_whitespace());
        let line = line
            .strip_prefix("- [ ] ")
            .or_else(|| line.strip_prefix("- [x] "))
            .or_else(|| line.strip_prefix("- "))
            .or_else(|| line.strip_prefix("* "))
            .or_else(|| line.strip_prefix("+ "))
            .unwrap_or(line);
        let line = match line.split_once(". ") {
            Some((number, rest)) if !number.is_empty() && number.chars().all(|c| c.is_ascii_digit()) => rest,
            _ => line,
        };
        words.push(without_marks(line));
    }
    words.join(" ").split_whitespace().collect::<Vec<_>>().join(" ")
}

fn without_marks(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(start) = rest.find(['[', '!', '*', '_', '`', '~']) {
        out.push_str(&rest[..start]);
        let tail = &rest[start..];
        if let Some(image) = tail.strip_prefix("![") {
            rest = image.split_once(')').map_or("", |(_, after)| after);
        } else if let Some(link) = tail.strip_prefix('[') {
            match link.split_once("](").and_then(|(text, after)| after.split_once(')').map(|(_, after)| (text, after))) {
                Some((text, after)) => {
                    out.push_str(text);
                    rest = after;
                }
                None => {
                    out.push('[');
                    rest = link;
                }
            }
        } else {
            let inside_a_word = tail.starts_with('_')
                && out.chars().last().is_some_and(char::is_alphanumeric)
                && tail[1..].chars().next().is_some_and(char::is_alphanumeric);
            if tail.starts_with('!') || inside_a_word {
                out.push_str(&tail[..1]);
            }
            rest = &tail[1..];
        }
    }
    out.push_str(rest);
    out
}

fn prefix(text: &str, bytes: usize) -> &str {
    if text.len() <= bytes {
        return text;
    }
    let mut end = bytes;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn front_matter_is_not_searched_or_shown() {
        assert_eq!(body("---\nsource: \"https://x.dev\"\n---\n# Title\n\nBody."), "# Title\n\nBody.");
        assert_eq!(body("# No front matter\n"), "# No front matter\n");
        assert_eq!(body("---\nunclosed"), "---\nunclosed");
    }

    #[test]
    fn a_result_shows_the_first_paragraph_that_says_something_as_plain_text() {
        let note = "# Launch plan\n\n![cover](images/cover.png)\n\n- Ship the **Shortcuts** actions\n- See [the spec](https://x.dev/spec) and `build.sh`\n\nLater.";
        assert_eq!(summary(note), "Ship the Shortcuts actions See the spec and build.sh");
    }

    #[test]
    fn an_underscore_inside_a_word_is_kept() {
        assert_eq!(plain("Rename _snake_case_ to `file_name`"), "Rename snake_case to file_name");
    }

    #[test]
    fn a_long_summary_is_cut_with_an_ellipsis() {
        let summary = summary(&"word ".repeat(100));
        assert!(summary.ends_with('…') && summary.chars().count() <= SUMMARY_CHARS + 1, "{summary}");
    }

    #[test]
    fn text_is_capped_on_a_character_boundary() {
        let text = "é".repeat(10);
        assert_eq!(prefix(&text, 5), "éé");
        assert_eq!(prefix("short", 100), "short");
    }

    #[test]
    fn a_note_is_read_with_the_hash_of_what_was_read() {
        let root = tempfile::tempdir().expect("root");
        std::fs::write(root.path().join("a.md"), "# Alpha\n\nFirst words.").expect("write");
        let workspace = WorkspaceRecord {
            id: "w1".to_owned(),
            name: "Notes".to_owned(),
            path: root.path().to_string_lossy().into_owned(),
            tabs: None,
            last_opened_at: None,
        };
        let document = IndexableDocument {
            relative_path: "a.md".to_owned(),
            title: "Alpha".to_owned(),
            content_hash: "stale".to_owned(),
            modified_at: 5,
        };
        let note = read(&workspace, &document).expect("read");
        assert_eq!(note.id, root.path().join("a.md").to_string_lossy());
        assert_eq!(note.content_hash, crate::db::content_hash("# Alpha\n\nFirst words."));
        assert_eq!((note.summary.as_str(), note.workspace_name.as_str()), ("First words.", "Notes"));
        assert!(read(&workspace, &IndexableDocument { relative_path: "missing.md".to_owned(), ..document }).is_none());
    }
}
