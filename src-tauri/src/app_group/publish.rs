//! Writing what the extensions read, so that none ever reads half a file and an
//! unchanged file is left alone.

use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::files::FileError;

pub(super) const DESTINATIONS_FILE: &str = "destinations.json";
pub(super) const NOTES_FILE: &str = "notes.json";

/// Write `value` as `name` in `dir` unless the file already says exactly that;
/// `true` when it was written. Written beside and renamed into place.
pub(super) fn publish(dir: &Path, name: &str, value: &impl Serialize) -> Result<bool, FileError> {
    let payload = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let path = dir.join(name);
    if fs::read(&path).is_ok_and(|current| current == payload) {
        return Ok(false);
    }
    fs::create_dir_all(dir)?;
    let staging = dir.join(format!(".{name}.tmp"));
    fs::write(&staging, &payload)?;
    fs::rename(&staging, &path)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_is_rewritten_only_when_what_it_says_changes() {
        let container = tempfile::tempdir().expect("container");
        let dir = container.path().join("Share");
        assert!(publish(&dir, NOTES_FILE, &["a"]).expect("first"));
        assert!(!publish(&dir, NOTES_FILE, &["a"]).expect("unchanged"));
        assert!(publish(&dir, NOTES_FILE, &["a", "b"]).expect("changed"));
        assert_eq!(fs::read_to_string(dir.join(NOTES_FILE)).expect("read"), "[\n  \"a\",\n  \"b\"\n]");
        let leftovers: Vec<_> = fs::read_dir(&dir).expect("dir").filter_map(Result::ok).map(|entry| entry.file_name()).collect();
        assert_eq!(leftovers, [NOTES_FILE], "no staging file is left behind");
    }
}
