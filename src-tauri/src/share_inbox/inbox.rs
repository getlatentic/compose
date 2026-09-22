//! The folder in the app-group container where the extensions leave clips.

use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;

use crate::app_group::contract::{Clip, CONTRACT_VERSION};
use crate::files::FileError;

const INBOX_DIR: &str = "Inbox";
const CLIP_FILE: &str = "clip.json";

#[derive(Debug, Clone)]
pub struct Inbox {
    root: PathBuf,
}

pub struct StoredClip {
    pub id: String,
    pub clip: Clip,
}

impl Inbox {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn inbox_dir(&self) -> PathBuf {
        self.root.join(INBOX_DIR)
    }

    /// Clips ready to file, oldest first. A clip the extension is still writing
    /// sits under a dot-named folder, and one written by a newer version waits
    /// for an app that can read it.
    pub fn pending(&self) -> Result<Vec<StoredClip>, FileError> {
        let entries = match fs::read_dir(self.inbox_dir()) {
            Ok(entries) => entries,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error.into()),
        };
        let mut clips = Vec::new();
        for id in entries
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| is_plain_name(name))
        {
            match self.read(&id) {
                Ok(Some(clip)) => clips.push(StoredClip { id, clip }),
                Ok(None) => {}
                Err(error) => eprintln!("share clip {id} is skipped: {error}"),
            }
        }
        clips.sort_by(|a, b| (a.clip.created_at, &a.id).cmp(&(b.clip.created_at, &b.id)));
        Ok(clips)
    }

    pub fn read(&self, id: &str) -> Result<Option<Clip>, FileError> {
        let raw = match fs::read(self.clip_dir(id)?.join(CLIP_FILE)) {
            Ok(raw) => raw,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let clip: Clip = serde_json::from_slice(&raw)
            .map_err(|error| format!("clip.json is unreadable: {error}"))?;
        Ok((clip.version <= CONTRACT_VERSION).then_some(clip))
    }

    pub fn image(&self, id: &str, name: &str) -> Option<Vec<u8>> {
        if !is_plain_name(name) {
            return None;
        }
        fs::read(self.clip_dir(id).ok()?.join(name)).ok()
    }

    pub fn remove(&self, id: &str) -> Result<(), FileError> {
        match fs::remove_dir_all(self.clip_dir(id)?) {
            Err(error) if error.kind() != ErrorKind::NotFound => Err(error.into()),
            _ => Ok(()),
        }
    }

    fn clip_dir(&self, id: &str) -> Result<PathBuf, FileError> {
        if !is_plain_name(id) {
            return Err(format!("{id:?} is not a clip id").into());
        }
        Ok(self.inbox_dir().join(id))
    }
}

/// One path component naming a real entry: not empty, not hidden, and unable to
/// climb out of the folder it is joined onto.
fn is_plain_name(name: &str) -> bool {
    !name.is_empty() && !name.starts_with('.') && !name.contains(['/', '\\'])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn leave(inbox: &Inbox, folder: &str, id: &str, created_at: i64) {
        let dir = inbox.inbox_dir().join(folder);
        fs::create_dir_all(&dir).expect("clip dir");
        let clip = format!(r#"{{"version":1,"id":"{id}","createdAt":{created_at},"title":"t"}}"#);
        fs::write(dir.join(CLIP_FILE), clip).expect("clip.json");
    }

    #[test]
    fn pending_is_oldest_first_and_skips_clips_still_being_written() {
        let share = tempfile::tempdir().expect("share");
        let inbox = Inbox::new(share.path().to_path_buf());
        leave(&inbox, "b", "b", 20);
        leave(&inbox, "a", "a", 10);
        leave(&inbox, ".incoming-c", "c", 5);
        let ids: Vec<_> = inbox.pending().expect("pending").into_iter().map(|c| c.id).collect();
        assert_eq!(ids, ["a", "b"]);
    }

    #[test]
    fn an_empty_container_has_nothing_pending() {
        let share = tempfile::tempdir().expect("share");
        let inbox = Inbox::new(share.path().join("never-created"));
        assert!(inbox.pending().expect("pending").is_empty());
    }

    #[test]
    fn a_clip_from_a_newer_extension_waits() {
        let share = tempfile::tempdir().expect("share");
        let inbox = Inbox::new(share.path().to_path_buf());
        let dir = inbox.inbox_dir().join("future");
        fs::create_dir_all(&dir).expect("dir");
        fs::write(dir.join(CLIP_FILE), r#"{"version":99,"id":"future","createdAt":0,"title":"t"}"#)
            .expect("clip.json");
        assert!(inbox.pending().expect("pending").is_empty());
        assert!(dir.exists(), "it is left for an app that can read it");
    }

    #[test]
    fn a_clip_id_or_image_name_cannot_reach_outside_the_inbox() {
        let share = tempfile::tempdir().expect("share");
        fs::write(share.path().join("secret"), b"x").expect("secret");
        let inbox = Inbox::new(share.path().join("Share"));
        assert!(inbox.read("../secret").is_err());
        assert!(inbox.remove("..").is_err());
        assert_eq!(inbox.image("id", "../../secret"), None);
    }
}
