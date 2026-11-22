//! What a review sandbox starts with besides the real files: the proposals
//! of earlier runs the writer has not decided yet. Without them each run
//! started from the real files, so an agent whose last proposal still waited
//! for review found its own edit missing, though its conversation said it
//! had made it.

use serde::Deserialize;
use std::path::{Component, Path};

/// One file as the sandbox should hold it. `content: None` means the earlier
/// run deleted it.
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SandboxFile {
    pub relative_path: String,
    pub content: Option<String>,
}

/// A conversation's waiting proposals are a handful of notes; past these the
/// request is not one the app makes.
const MAX_FILES: usize = 256;
const MAX_TOTAL_BYTES: usize = 64 * 1024 * 1024;

/// A path inside the sandbox: relative, and with no `..`, root or prefix part.
fn is_contained(relative: &Path) -> bool {
    relative.as_os_str().len() > 0 && relative.components().all(|part| matches!(part, Component::Normal(_)))
}

fn check(files: &[SandboxFile]) -> Result<(), String> {
    if files.len() > MAX_FILES {
        return Err(format!("too many waiting proposals for one run ({})", files.len()));
    }
    let total: usize = files.iter().filter_map(|file| file.content.as_ref()).map(String::len).sum();
    if total > MAX_TOTAL_BYTES {
        return Err("the waiting proposals are too large to copy into the run".to_owned());
    }
    match files.iter().find(|file| !is_contained(Path::new(&file.relative_path))) {
        Some(file) => Err(format!("a waiting proposal names a path outside the notes: {}", file.relative_path)),
        None => Ok(()),
    }
}

/// Write the files into a freshly cloned sandbox. Every path is checked
/// before anything is written, so a bad request changes nothing.
pub fn apply_sandbox_overlay(clone_root: &Path, files: &[SandboxFile]) -> Result<(), String> {
    check(files)?;
    for file in files {
        let target = clone_root.join(&file.relative_path);
        match &file.content {
            Some(content) => {
                if let Some(parent) = target.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|error| format!("could not prepare {}: {error}", file.relative_path))?;
                }
                std::fs::write(&target, content)
                    .map_err(|error| format!("could not copy {} into the run: {error}", file.relative_path))?;
            }
            None => match std::fs::remove_file(&target) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(format!("could not remove {} from the run: {error}", file.relative_path)),
            },
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn file(path: &str, content: Option<&str>) -> SandboxFile {
        SandboxFile { relative_path: path.to_owned(), content: content.map(str::to_owned) }
    }

    #[test]
    fn writes_rewritten_and_new_files_and_removes_deleted_ones() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("note.md"), "before").unwrap();
        fs::write(root.path().join("old.md"), "old").unwrap();

        apply_sandbox_overlay(
            root.path(),
            &[file("note.md", Some("after")), file("Ideas/new.md", Some("new")), file("old.md", None), file("gone.md", None)],
        )
        .unwrap();

        assert_eq!(fs::read_to_string(root.path().join("note.md")).unwrap(), "after");
        assert_eq!(fs::read_to_string(root.path().join("Ideas/new.md")).unwrap(), "new");
        assert!(!root.path().join("old.md").exists());
    }

    #[test]
    fn refuses_a_path_outside_the_sandbox_and_writes_nothing() {
        let root = tempfile::tempdir().unwrap();
        let sandbox = root.path().join("sandbox");
        fs::create_dir(&sandbox).unwrap();
        for bad in ["../escape.md", "/etc/passwd", "", "a/../../b.md"] {
            let result = apply_sandbox_overlay(&sandbox, &[file("fine.md", Some("x")), file(bad, Some("x"))]);
            assert!(result.is_err(), "{bad:?} must be refused");
        }
        assert!(!sandbox.join("fine.md").exists());
        assert!(!root.path().join("escape.md").exists());
    }

    #[test]
    fn refuses_more_files_than_a_conversation_has() {
        let root = tempfile::tempdir().unwrap();
        let many: Vec<SandboxFile> = (0..=MAX_FILES).map(|i| file(&format!("n{i}.md"), Some("x"))).collect();
        assert!(apply_sandbox_overlay(root.path(), &many).is_err());
    }
}
