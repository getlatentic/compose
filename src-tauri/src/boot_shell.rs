//! The last screen the app drew, kept so the next launch can put it up before
//! React exists.
//!
//! A web view cannot paint until its bundle has loaded and rendered — around
//! 650ms here — and until then the window has nothing true to show. But the app
//! drew this exact screen last time, and the launch payload restores the same
//! workspace and the same document, so the same screen is what it is about to
//! draw again. Writing it into the page at parse time makes the window openable
//! in a fifth of that.
//!
//! It is a picture, not state: inert markup that React replaces wholesale the
//! moment it is ready. Nothing reads it back.

use std::path::{Path, PathBuf};

/// Past this the picture costs more to carry than the wait it saves, and
/// something has gone wrong with what is being captured.
const MAX_SHELL_BYTES: usize = 4 * 1024 * 1024;

const FILE_NAME: &str = "boot_shell.html";

fn shell_path(profile_dir: &Path) -> PathBuf {
    profile_dir.join(FILE_NAME)
}

pub(crate) fn read(profile_dir: &Path) -> Option<String> {
    let markup = std::fs::read_to_string(shell_path(profile_dir)).ok()?;
    (!markup.is_empty() && markup.len() <= MAX_SHELL_BYTES).then_some(markup)
}

/// Record the screen just drawn. Errors are swallowed by the caller: a launch
/// that cannot save its picture simply takes the long way next time.
pub(crate) fn write(profile_dir: &Path, markup: &str) -> Result<(), String> {
    if markup.len() > MAX_SHELL_BYTES {
        return Err(format!("shell is {} bytes, past the cap", markup.len()));
    }
    std::fs::write(shell_path(profile_dir), markup)
        .map_err(|error| format!("could not save the boot shell: {error}"))
}

#[tauri::command(async)]
pub fn boot_shell_store(markup: String) -> Result<(), String> {
    let profile_dir =
        crate::profile_migration::profile_dir().ok_or_else(|| "no profile directory".to_owned())?;
    write(&profile_dir, &markup)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn a_recorded_screen_comes_back_for_the_next_launch() {
        let dir = tempdir().expect("dir");
        write(dir.path(), "<div>tree</div>").expect("write");

        assert_eq!(read(dir.path()).as_deref(), Some("<div>tree</div>"));
    }

    #[test]
    fn a_first_launch_has_no_screen_to_replay() {
        let dir = tempdir().expect("dir");

        assert_eq!(read(dir.path()), None);
    }

    #[test]
    fn an_oversized_screen_is_refused_rather_than_carried() {
        let dir = tempdir().expect("dir");
        let huge = "x".repeat(MAX_SHELL_BYTES + 1);

        assert!(write(dir.path(), &huge).is_err());
        assert_eq!(read(dir.path()), None, "and nothing is left behind to replay");
    }
}
