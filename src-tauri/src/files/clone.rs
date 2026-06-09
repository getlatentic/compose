//! Copy-on-write workspace cloning for the edit-review gate.
//!
//! Before a write-capable harness (Claude / Codex) runs under review,
//! Compose clones the workspace into a temp dir and points the harness at
//! the clone, so the user's real files stay untouched until they approve the
//! changes (no editor flicker mid-run). On macOS/APFS each file is cloned
//! copy-on-write via `clonefile(2)` — instant, ~no extra disk. Elsewhere it
//! falls back to a recursive byte copy. Both walk the tree honoring the same
//! ignore rules as the workspace scan (skip `.git` / `node_modules` /
//! `target` / `dist` and every dotfile) at *every* level, so the clone never
//! drags build output or VCS metadata along.

use super::{is_ignored_segment, FileError};
use std::path::Path;

/// How a workspace was cloned — surfaced for logging / telemetry only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloneMethod {
    /// Every file was cloned copy-on-write via `clonefile(2)` (APFS).
    CopyOnWrite,
    /// At least one file fell back to a recursive byte copy — non-APFS,
    /// cross-device, or non-macOS.
    DeepCopy,
}

/// Clone the non-ignored contents of `src` into `dst` (created if missing).
/// Files are cloned copy-on-write where the platform supports it, falling
/// back to a byte copy otherwise; the returned [`CloneMethod`] is `DeepCopy`
/// if any file took the fallback path.
pub fn clone_workspace(src: &Path, dst: &Path) -> Result<CloneMethod, FileError> {
    let mut method = CloneMethod::CopyOnWrite;
    clone_tree(src, dst, &mut method)?;
    Ok(method)
}

/// Recursively mirror `src` into `dst`, honoring [`is_ignored_segment`] at
/// every level. Directories (including empty ones) are recreated; files are
/// cloned copy-on-write or byte-copied; symlinks are skipped rather than
/// followed — a clone must never reach outside itself.
fn clone_tree(src: &Path, dst: &Path, method: &mut CloneMethod) -> Result<(), FileError> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        if is_ignored_segment(&name.to_string_lossy()) {
            continue;
        }
        // `DirEntry::file_type` does not follow symlinks, so a symlinked
        // directory reports as a symlink and is skipped below.
        let file_type = entry.file_type()?;
        let from = entry.path();
        let to = dst.join(&name);
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            clone_tree(&from, &to, method)?;
        } else if file_type.is_file()
            && !try_cow_clone(&from, &to)? {
                *method = CloneMethod::DeepCopy;
                std::fs::copy(&from, &to)?;
            }
    }
    Ok(())
}

/// Attempt a copy-on-write clone of the single file `src` → `dst` (which must
/// not yet exist). Returns `Ok(true)` on success, `Ok(false)` when
/// copy-on-write is unavailable for this source (so the caller byte-copies),
/// and `Err` on a genuine failure.
#[cfg(target_os = "macos")]
fn try_cow_clone(src: &Path, dst: &Path) -> Result<bool, FileError> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let src_c = CString::new(src.as_os_str().as_bytes())
        .map_err(|_| FileError::from("clone source path contains a NUL byte"))?;
    let dst_c = CString::new(dst.as_os_str().as_bytes())
        .map_err(|_| FileError::from("clone destination path contains a NUL byte"))?;
    // SAFETY: both arguments are valid NUL-terminated C strings that outlive
    // the call; `clonefile` only reads them and returns a status code.
    let status = unsafe { libc::clonefile(src_c.as_ptr(), dst_c.as_ptr(), 0) };
    if status == 0 {
        return Ok(true);
    }
    let error = std::io::Error::last_os_error();
    match error.raw_os_error() {
        // Filesystem can't clone (non-APFS) or the copy would cross devices —
        // both are expected; fall back to a byte copy.
        Some(libc::ENOTSUP) | Some(libc::EOPNOTSUPP) | Some(libc::EXDEV) => Ok(false),
        _ => Err(FileError::from(format!(
            "could not clone {}: {error}",
            src.display()
        ))),
    }
}

#[cfg(not(target_os = "macos"))]
fn try_cow_clone(_src: &Path, _dst: &Path) -> Result<bool, FileError> {
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write(path: &Path, content: &[u8]) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn clone_copies_files_and_nested_dirs_and_skips_ignored() {
        let src = tempdir().unwrap();
        let dst = tempdir().unwrap();
        let clone_root = dst.path().join("clone");

        write(&src.path().join("README.md"), b"hello");
        write(&src.path().join("notes/launch.md"), b"launch");
        // Non-markdown files belong to the clone too — the agent may touch them.
        write(&src.path().join("assets/data.txt"), b"raw");
        // Ignored at the top level and nested — neither should be cloned.
        write(&src.path().join(".git/HEAD"), b"ref:");
        write(&src.path().join("node_modules/pkg/index.md"), b"skip");
        write(&src.path().join("notes/.cache/tmp.md"), b"skip");

        clone_workspace(src.path(), &clone_root).expect("clone");

        assert_eq!(fs::read_to_string(clone_root.join("README.md")).unwrap(), "hello");
        assert_eq!(
            fs::read_to_string(clone_root.join("notes/launch.md")).unwrap(),
            "launch"
        );
        assert_eq!(
            fs::read_to_string(clone_root.join("assets/data.txt")).unwrap(),
            "raw"
        );
        assert!(!clone_root.join(".git").exists());
        assert!(!clone_root.join("node_modules").exists());
        assert!(!clone_root.join("notes/.cache").exists());
    }

    #[test]
    fn clone_into_existing_empty_dir() {
        let src = tempdir().unwrap();
        let dst = tempdir().unwrap();
        write(&src.path().join("a.md"), b"x");

        clone_workspace(src.path(), dst.path()).expect("clone into existing dir");
        assert_eq!(fs::read_to_string(dst.path().join("a.md")).unwrap(), "x");
    }

    #[test]
    fn clone_preserves_empty_dirs_and_binary_files() {
        let src = tempdir().unwrap();
        let dst = tempdir().unwrap();
        let clone_root = dst.path().join("clone");

        fs::create_dir_all(src.path().join("drafts")).unwrap();
        write(&src.path().join("logo.bin"), &[0xff, 0x00, 0xfe, 0x42]);

        clone_workspace(src.path(), &clone_root).expect("clone");

        assert!(clone_root.join("drafts").is_dir());
        assert_eq!(
            fs::read(clone_root.join("logo.bin")).unwrap(),
            vec![0xff, 0x00, 0xfe, 0x42]
        );
    }
}
