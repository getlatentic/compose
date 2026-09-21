//! A new note named after its title: the title made into a file name that any
//! file system a workspace syncs to accepts, numbered when that name is taken.

use crate::db::MetadataStore;
use crate::workspace::WorkspaceRegistry;

use super::{create_file, FileError};

/// Past this many same-named files a collision is a bug, not bad luck.
pub(crate) const MAX_NAME_ATTEMPTS: usize = 1000;
const MAX_STEM_CHARS: usize = 80;
/// Characters a file name cannot carry on every system a workspace might sync to.
const UNSAFE_IN_FILE_NAMES: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];

/// The file name a title is saved under, without its extension; `None` when
/// nothing of the title can be used.
pub(crate) fn file_stem(title: &str) -> Option<String> {
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
    (!stem.is_empty()).then(|| stem.to_owned())
}

/// The `attempt`th path to try for a note: `Title.md`, then `Title 2.md`, …
fn candidate(stem: &str, attempt: usize) -> String {
    if attempt <= 1 {
        format!("{stem}.md")
    } else {
        format!("{stem} {attempt}.md")
    }
}

/// Write `content` as a new note named `stem` at the workspace root, and record
/// it; returns its workspace-relative path. An existing note is never touched.
pub(crate) fn create_note(
    registry: &WorkspaceRegistry,
    metadata: &MetadataStore,
    workspace_id: &str,
    stem: &str,
    content: &str,
) -> Result<String, FileError> {
    for attempt in 1..=MAX_NAME_ATTEMPTS {
        let relative_path = candidate(stem, attempt);
        match create_file(registry, workspace_id, &relative_path, content) {
            Ok(written) => {
                metadata.record_document_written(
                    workspace_id,
                    &relative_path,
                    content,
                    written.last_modified_ms,
                    content.len() as u64,
                )?;
                return Ok(relative_path);
            }
            Err(FileError::AlreadyExists { .. }) => continue,
            Err(error) => return Err(error),
        }
    }
    Err(format!("no free name for a note named {stem}").into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_title_loses_what_a_file_name_cannot_carry() {
        assert_eq!(file_stem("Proof of Code: Understanding").as_deref(), Some("Proof of Code Understanding"));
        assert_eq!(file_stem("a/b\\c*d?").as_deref(), Some("a b c d"));
        assert_eq!(file_stem("  lots   of\tspace\n").as_deref(), Some("lots of space"));
    }

    #[test]
    fn a_title_cannot_hide_the_file_or_leave_it_nameless() {
        assert_eq!(file_stem("...hidden").as_deref(), Some("hidden"));
        assert_eq!(file_stem("trailing. ").as_deref(), Some("trailing"));
        assert_eq!(file_stem("://"), None);
        assert_eq!(file_stem(""), None);
    }

    #[test]
    fn a_long_title_is_cut_on_a_character_not_a_byte() {
        let stem = file_stem(&"é".repeat(200)).expect("stem");
        assert_eq!(stem.chars().count(), MAX_STEM_CHARS);
    }

    #[test]
    fn candidates_count_up_from_the_bare_name() {
        assert_eq!(candidate("Note", 1), "Note.md");
        assert_eq!(candidate("Note", 3), "Note 3.md");
    }

    #[test]
    fn a_taken_name_is_numbered_and_the_note_there_is_left_alone() {
        let [config, data, vault] = [(); 3].map(|()| tempfile::tempdir().expect("dir"));
        let registry = WorkspaceRegistry::default();
        registry.init_from_dir(config.path()).expect("registry");
        let workspace_id = registry
            .add(vault.path().to_string_lossy().into_owned())
            .expect("workspace")
            .workspaces[0]
            .id
            .clone();
        let metadata = MetadataStore::default();
        metadata.init_from_dir(data.path()).expect("metadata");
        std::fs::write(vault.path().join("Idea.md"), "first").expect("existing note");

        let path = create_note(&registry, &metadata, &workspace_id, "Idea", "second").expect("create");

        assert_eq!(path, "Idea 2.md");
        assert_eq!(std::fs::read_to_string(vault.path().join("Idea.md")).unwrap(), "first");
        assert_eq!(std::fs::read_to_string(vault.path().join("Idea 2.md")).unwrap(), "second");
    }
}
