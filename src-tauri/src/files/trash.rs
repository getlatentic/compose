//! Recoverable soft-delete trash.
//!
//! Compose never hard-deletes a user's file. A delete — whether the user's
//! own, or one an assistant proposed and the user approved — moves the file
//! into an app-managed trash directory outside any workspace. The file's last
//! content is also snapshotted into history (by the caller) so it can be
//! restored, and the physical file in the trash is a second safety net.
//!
//! This module owns the trash's on-disk layout: a file lives at
//! `<trash_root>/<vault_id>/<trashed_name>`, where `trashed_name` is
//! `<uuid>-<original name>`. The retention sweep ([`super::trash_sweep`])
//! records that name in the db *before* the move and reads it back to purge an
//! expired file, so name generation, the move, and the purge are kept as
//! separate seams here rather than one all-in-one helper.

use super::FileError;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// The collision-proof name a file takes inside the trash:
/// `<uuid>-<original name>` — unique even for repeated deletes of files that
/// share a name, with the suffix keeping the trashed file recognizable.
///
/// Exposed so a caller can record a trash-entry row under this name *before*
/// the physical move (the retention sweep relies on every trashed file having
/// a row — see [`super::soft_delete`]).
pub fn trashed_name_for(source: &Path) -> String {
    let file_name = source
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_owned());
    format!("{}-{file_name}", Uuid::new_v4())
}

/// Absolute path of a trashed file, given the name [`trashed_name_for`]
/// produced. The single place the trash layout is reconstructed.
pub fn trashed_path(trash_root: &Path, vault_id: &str, trashed_name: &str) -> PathBuf {
    trash_root.join(vault_id).join(trashed_name)
}

/// Move `source` into the trash under a pre-chosen `trashed_name`, returning
/// its new path. Uses a rename when possible and falls back to
/// copy-then-remove across devices. Errors if `source` is missing.
pub fn move_to_trash_as(
    trash_root: &Path,
    vault_id: &str,
    source: &Path,
    trashed_name: &str,
) -> Result<PathBuf, FileError> {
    if !source.exists() {
        return Err(FileError::NotFound {
            message: format!("{} does not exist", source.display()),
        });
    }
    let vault_trash = trash_root.join(vault_id);
    std::fs::create_dir_all(&vault_trash)?;
    let destination = vault_trash.join(trashed_name);

    match std::fs::rename(source, &destination) {
        Ok(()) => Ok(destination),
        Err(error) if error.raw_os_error() == Some(libc_exdev()) => {
            // Trash sits on a different volume than the workspace — rename
            // can't cross devices, so copy then remove the original. Handles
            // both files and folders (a deleted folder trashes its whole tree).
            copy_across_devices(source, &destination)?;
            Ok(destination)
        }
        Err(error) => Err(error.into()),
    }
}

/// Recursively copy `source` to `destination` then remove `source` — the
/// cross-volume fallback for [`move_to_trash_as`], where `fs::rename` can't
/// reach. `fs::copy` is file-only, so directories are walked by hand.
fn copy_across_devices(source: &Path, destination: &Path) -> Result<(), FileError> {
    if source.is_dir() {
        std::fs::create_dir_all(destination)?;
        for entry in std::fs::read_dir(source)? {
            let entry = entry?;
            copy_across_devices(&entry.path(), &destination.join(entry.file_name()))?;
        }
        std::fs::remove_dir_all(source)?;
    } else {
        std::fs::copy(source, destination)?;
        std::fs::remove_file(source)?;
    }
    Ok(())
}

/// Move `source` into the trash under a freshly generated name. Convenience for
/// callers that don't need the name beforehand.
pub fn move_to_trash(trash_root: &Path, vault_id: &str, source: &Path) -> Result<PathBuf, FileError> {
    move_to_trash_as(trash_root, vault_id, source, &trashed_name_for(source))
}

/// Permanently remove a trashed file (the only place the trash is hard-deleted,
/// driven by the retention sweep). A file that is already gone counts as
/// success, so a stale entry never wedges the sweep.
pub fn purge_trashed_file(
    trash_root: &Path,
    vault_id: &str,
    trashed_name: &str,
) -> Result<(), FileError> {
    let path = trashed_path(trash_root, vault_id, trashed_name);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(target_os = "macos")]
fn libc_exdev() -> i32 {
    libc::EXDEV
}

#[cfg(not(target_os = "macos"))]
fn libc_exdev() -> i32 {
    // EXDEV is 18 on Linux as well; this constant only gates the copy
    // fallback, so a platform mismatch would simply surface the original
    // rename error instead — still correct, just not optimized.
    18
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn moves_file_into_vault_trash_and_leaves_source_gone() {
        let workspace = tempdir().unwrap();
        let trash = tempdir().unwrap();
        let source = workspace.path().join("note.md");
        fs::write(&source, "bye").unwrap();

        let trashed = move_to_trash(trash.path(), "vault-1", &source).expect("trash");

        assert!(!source.exists(), "source must be moved, not copied");
        assert!(trashed.starts_with(trash.path().join("vault-1")));
        assert_eq!(fs::read_to_string(&trashed).unwrap(), "bye");
        assert!(trashed
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with("-note.md"));
    }

    #[test]
    fn repeated_deletes_of_same_name_do_not_collide() {
        let workspace = tempdir().unwrap();
        let trash = tempdir().unwrap();

        let first = workspace.path().join("dup.md");
        fs::write(&first, "one").unwrap();
        let trashed_one = move_to_trash(trash.path(), "v", &first).expect("trash one");

        fs::write(&first, "two").unwrap();
        let trashed_two = move_to_trash(trash.path(), "v", &first).expect("trash two");

        assert_ne!(trashed_one, trashed_two);
        assert_eq!(fs::read_to_string(&trashed_one).unwrap(), "one");
        assert_eq!(fs::read_to_string(&trashed_two).unwrap(), "two");
    }

    #[test]
    fn missing_source_errors() {
        let trash = tempdir().unwrap();
        let result = move_to_trash(trash.path(), "v", Path::new("/nope/missing.md"));
        assert!(matches!(result, Err(FileError::NotFound { .. })));
    }

    #[test]
    fn purge_removes_a_trashed_file_and_treats_missing_as_success() {
        let workspace = tempdir().unwrap();
        let trash = tempdir().unwrap();
        let source = workspace.path().join("note.md");
        fs::write(&source, "bye").unwrap();
        let name = trashed_name_for(&source);
        move_to_trash_as(trash.path(), "vault-1", &source, &name).expect("trash");

        let path = trashed_path(trash.path(), "vault-1", &name);
        assert!(path.exists());
        purge_trashed_file(trash.path(), "vault-1", &name).expect("purge");
        assert!(!path.exists(), "purge hard-deletes the trashed file");

        // A second purge of the now-gone file is still Ok — a stale entry must
        // never wedge the sweep.
        purge_trashed_file(trash.path(), "vault-1", &name).expect("purge missing is ok");
    }
}
