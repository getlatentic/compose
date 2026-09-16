//! Which paths are Markdown notes.
//!
//! One definition for everything that decides it: the workspace scan and
//! watcher, link resolution, and search, natively and in WASM.

/// The extensions a Markdown note is saved under, matched case-insensitively.
/// `.md` comes first: it is the one a new note, or a link written without an
/// extension, is given.
pub const MARKDOWN_EXTENSIONS: [&str; 4] = ["md", "markdown", "mdown", "mkd"];

/// The Markdown extension `path` ends in, as it is written there.
///
/// A leading dot names a hidden file rather than starting an extension, so
/// `.md` on its own is not a note.
pub fn markdown_extension(path: &str) -> Option<&str> {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let dot = name.rfind('.').filter(|&index| index > 0)?;
    let extension = &name[dot + 1..];
    MARKDOWN_EXTENSIONS
        .iter()
        .any(|known| extension.eq_ignore_ascii_case(known))
        .then_some(extension)
}

pub fn is_markdown_path(path: &str) -> bool {
    markdown_extension(path).is_some()
}

/// `path` without its Markdown extension; any other path unchanged.
pub fn strip_markdown_extension(path: &str) -> &str {
    match markdown_extension(path) {
        Some(extension) => &path[..path.len() - extension.len() - 1],
        None => path,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_markdown_spelling_is_a_note() {
        for path in ["a.md", "a.markdown", "a.mdown", "a.mkd", "dir/Notes.MD", "x.Markdown"] {
            assert!(is_markdown_path(path), "{path}");
        }
    }

    #[test]
    fn other_files_are_not() {
        for path in ["a.txt", "a.mdx", "a.md.bak", "readme", "dir.md/file", ".md", "dir/.markdown"] {
            assert!(!is_markdown_path(path), "{path}");
        }
    }

    #[test]
    fn the_extension_comes_back_as_written() {
        assert_eq!(markdown_extension("notes/Plan.MD"), Some("MD"));
        assert_eq!(markdown_extension("notes\\plan.mkd"), Some("mkd"));
        assert_eq!(markdown_extension("plan.txt"), None);
    }

    #[test]
    fn stripping_leaves_the_rest_of_the_path() {
        assert_eq!(strip_markdown_extension("notes/plan.markdown"), "notes/plan");
        assert_eq!(strip_markdown_extension("notes/v1.2.md"), "notes/v1.2");
        assert_eq!(strip_markdown_extension("notes/plan.txt"), "notes/plan.txt");
        assert_eq!(strip_markdown_extension("notes/.md"), "notes/.md");
    }
}
