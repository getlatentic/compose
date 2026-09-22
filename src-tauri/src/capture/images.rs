//! Images pasted into a quick note wait in that note's own folder, outside every
//! workspace, so a note deleted unsaved leaves nothing behind. Saving the note
//! moves them into the workspace beside it, renaming any that would overwrite a
//! file there, and the note's links follow.

use std::fs;
use std::path::{Component, Path, PathBuf};

/// The folder a quick note's images wait in.
pub(super) fn folder(notes_dir: &Path, id: &str) -> PathBuf {
    let safe: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    notes_dir.join(safe)
}

/// Keep `bytes` at `relative` in the note's folder: `images/pasted.png`, as the
/// editor names it. Anything that would leave the folder is refused.
pub(super) fn save(folder: &Path, relative: &str, bytes: &[u8]) -> Result<(), String> {
    let path = inside(folder, relative).ok_or_else(|| format!("{relative} is not a place for an image"))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("could not keep the image: {error}"))?;
    }
    fs::write(&path, bytes).map_err(|error| format!("could not keep the image: {error}"))
}

/// Move every image in `folder` into `destination` (the folder the note is saved
/// in) and return `text` with links to any image that had to be renamed changed
/// to its new name. The note's folder goes once it is empty.
pub(super) fn move_into(folder: &Path, destination: &Path, text: &str) -> Result<String, String> {
    let mut text = text.to_owned();
    for relative in files_under(folder, Path::new("")) {
        let from = folder.join(&relative);
        let to = free_path(destination, &relative);
        if let Some(parent) = to.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("could not move an image: {error}"))?;
        }
        move_file(&from, &to)?;
        let old = link(&relative);
        let new = link(to.strip_prefix(destination).unwrap_or(&relative));
        if old != new {
            text = text.replace(&format!("]({old})"), &format!("]({new})"));
        }
    }
    let _ = fs::remove_dir_all(folder);
    Ok(text)
}

/// Throw away a note's images, as when the note is deleted unsaved.
pub(super) fn discard(folder: &Path) {
    let _ = fs::remove_dir_all(folder);
}

fn inside(folder: &Path, relative: &str) -> Option<PathBuf> {
    let relative = Path::new(relative);
    let plain = relative.components().all(|part| matches!(part, Component::Normal(_)));
    (plain && relative.components().next().is_some()).then(|| folder.join(relative))
}

fn files_under(root: &Path, relative: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root.join(relative)) else { return Vec::new() };
    let mut files = Vec::new();
    for entry in entries.flatten() {
        let path = relative.join(entry.file_name());
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => files.extend(files_under(root, &path)),
            Ok(kind) if kind.is_file() => files.push(path),
            _ => {}
        }
    }
    files.sort();
    files
}

/// `relative` under `destination`, or the same name with -2, -3… before its
/// extension when a file is already there.
fn free_path(destination: &Path, relative: &Path) -> PathBuf {
    let wanted = destination.join(relative);
    if !wanted.exists() {
        return wanted;
    }
    let stem = wanted.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
    let extension = wanted.extension().map(|extension| format!(".{}", extension.to_string_lossy())).unwrap_or_default();
    (2..)
        .map(|number| wanted.with_file_name(format!("{stem}-{number}{extension}")))
        .find(|candidate| !candidate.exists())
        .unwrap_or(wanted)
}

/// A rename, or a copy and delete when the note's folder and the workspace are
/// on different volumes.
fn move_file(from: &Path, to: &Path) -> Result<(), String> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    fs::copy(from, to).map_err(|error| format!("could not move an image: {error}"))?;
    let _ = fs::remove_file(from);
    Ok(())
}

/// A path as a Markdown link writes it: forward slashes.
fn link(path: &Path) -> String {
    path.components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_image_is_kept_in_the_note_folder_and_nowhere_else() {
        let dir = tempfile::tempdir().expect("dir");
        let folder = folder(dir.path(), "note-1");
        save(&folder, "images/pasted.png", b"png").expect("save");
        assert_eq!(fs::read(folder.join("images/pasted.png")).expect("read"), b"png");
        for escape in ["../outside.png", "/tmp/absolute.png", "images/../../x.png", ""] {
            assert!(save(&folder, escape, b"x").is_err(), "{escape} must be refused");
        }
    }

    #[test]
    fn saving_moves_the_images_beside_the_note_and_renames_on_a_clash() {
        let dir = tempfile::tempdir().expect("dir");
        let workspace = dir.path().join("workspace");
        fs::create_dir_all(workspace.join("images")).expect("images");
        fs::write(workspace.join("images/pasted.png"), b"someone else's").expect("existing");
        let folder = folder(&dir.path().join("notes"), "note-1");
        save(&folder, "images/pasted.png", b"mine").expect("save");
        save(&folder, "images/other.png", b"other").expect("save");

        let text = "![a](images/pasted.png)\n![b](images/other.png)";
        let moved = move_into(&folder, &workspace, text).expect("move");

        assert_eq!(moved, "![a](images/pasted-2.png)\n![b](images/other.png)");
        assert_eq!(fs::read(workspace.join("images/pasted-2.png")).expect("read"), b"mine");
        assert_eq!(fs::read(workspace.join("images/pasted.png")).expect("read"), b"someone else's");
        assert_eq!(fs::read(workspace.join("images/other.png")).expect("read"), b"other");
        assert!(!folder.exists(), "the note's folder goes once empty");
    }

    #[test]
    fn a_note_without_images_saves_as_it_is() {
        let dir = tempfile::tempdir().expect("dir");
        let text = move_into(&dir.path().join("none"), dir.path(), "Just text").expect("move");
        assert_eq!(text, "Just text");
    }

    #[test]
    fn a_discarded_note_leaves_nothing_behind() {
        let dir = tempfile::tempdir().expect("dir");
        let folder = folder(dir.path(), "note-1");
        save(&folder, "images/pasted.png", b"png").expect("save");
        discard(&folder);
        assert!(!folder.exists());
    }

    #[test]
    fn a_note_id_cannot_name_a_folder_elsewhere() {
        assert_eq!(folder(Path::new("/data/quick-notes"), "../../etc"), Path::new("/data/quick-notes/etc"));
    }
}
