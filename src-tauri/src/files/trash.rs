//! Recoverable soft-delete trash.
//!
//! Compose never hard-deletes a user's file. A delete — whether the user's
//! own, or one an assistant proposed and the user approved — moves the file
//! into an app-managed trash directory outside any workspace. The file's last
//! content is also snapshotted into history (by the caller) so it can be
//! restored, and the physical file in the trash is a second safety net. There
//! is intentionally no UI that empties this trash in v1: deletes are rare and
//! always reversible.

use super::FileError;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// Move `source` into `<trash_root>/<vault_id>/` under a collision-proof
/// name, returning the file's new path. Uses a rename when possible and
/// falls back to copy-then-remove across devices. Errors if `source` is
/// missing.
pub fn move_to_trash(
    trash_root: &Path,
    vault_id: &str,
    source: &Path,
) -> Result<PathBuf, FileError> {
    if !source.exists() {
        return Err(FileError::NotFound {
            message: format!("{} does not exist", source.display()),
        });
    }
    let vault_trash = trash_root.join(vault_id);
    std::fs::create_dir_all(&vault_trash)?;

    let file_name = source
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_owned());
    // `<uuid>-<original name>` — unique even for repeated deletes of files
    // that share a name, and the suffix keeps the trashed file recognizable.
    let destination = vault_trash.join(format!("{}-{file_name}", Uuid::new_v4()));

    match std::fs::rename(source, &destination) {
        Ok(()) => Ok(destination),
        Err(error) if error.raw_os_error() == Some(libc_exdev()) => {
            // Trash sits on a different volume than the workspace — rename
            // can't cross devices, so copy then remove the original.
            std::fs::copy(source, &destination)?;
            std::fs::remove_file(source)?;
            Ok(destination)
        }
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
}
