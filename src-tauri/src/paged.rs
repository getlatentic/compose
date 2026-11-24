//! Files read and edited a window at a time, for the interface.
//!
//! A file too large to hold is opened here and never read whole: the
//! interface asks for the text around a place and is given a window of it,
//! and sends back each edit made in one. The reading and the edits are
//! `paged_document`; this is the open files and the commands.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use paged_document::{PagedDocument, SaveError, Saved, Window};
use serde::Serialize;
use tauri::State;

use crate::files::FileError;
use crate::workspace::WorkspaceRegistry;

/// The most files open this way at once. Each holds a file handle and a
/// thread.
const MOST_OPEN: usize = 16;
/// The most text one window may be asked for.
const LARGEST_WINDOW: usize = 4 * 1024 * 1024;

/// A file open a window at a time.
struct Open {
    path: PathBuf,
    document: Arc<PagedDocument>,
    /// The screens showing it. With none, it stays open only while it has
    /// edits that could not be saved, so opening it again finds them.
    holders: usize,
}

/// The files open a window at a time, by the id the interface holds.
#[derive(Default)]
pub struct PagedDocuments {
    open: Mutex<HashMap<u64, Open>>,
    last_id: AtomicU64,
}

impl PagedDocuments {
    fn lock(&self) -> MutexGuard<'_, HashMap<u64, Open>> {
        self.open.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The id of the file at `path`, opening it if no screen has it open.
    fn hold(&self, path: &Path) -> Result<(u64, Arc<PagedDocument>), FileError> {
        let mut open = self.lock();
        if let Some((id, held)) = open.iter_mut().find(|(_, held)| held.path == path) {
            held.holders += 1;
            return Ok((*id, Arc::clone(&held.document)));
        }
        if open.len() >= MOST_OPEN {
            return Err(format!("{MOST_OPEN} large files are open already; close one first").into());
        }
        // Opening reads nothing of the file, so the lock is held for no I/O
        // to speak of, and two screens cannot open one file twice.
        let document = Arc::new(PagedDocument::open(path)?);
        let id = self.last_id.fetch_add(1, Ordering::Relaxed) + 1;
        open.insert(id, Open { path: path.to_owned(), document: Arc::clone(&document), holders: 1 });
        Ok((id, document))
    }

    /// The document, held outside the lock: a read of the file does not
    /// keep the other open files waiting.
    fn get(&self, id: u64) -> Result<Arc<PagedDocument>, FileError> {
        self.lock().get(&id).map(|held| Arc::clone(&held.document)).ok_or_else(|| FileError::NotFound { message: format!("no large file is open as {id}") })
    }

    /// One screen let go of the file. The document, when that was the last.
    fn release(&self, id: u64) -> Option<Arc<PagedDocument>> {
        let mut open = self.lock();
        let held = open.get_mut(&id)?;
        held.holders = held.holders.saturating_sub(1);
        (held.holders == 0).then(|| Arc::clone(&held.document))
    }

    /// Forgets the file if no screen took it up again meanwhile.
    fn forget(&self, id: u64) -> Option<Open> {
        let mut open = self.lock();
        if open.get(&id).is_some_and(|held| held.holders == 0) { open.remove(&id) } else { None }
    }

    /// Saves every file with edits, as the app quits. A file that cannot be
    /// saved does not keep the others from it.
    pub fn save_all(&self) {
        let documents: Vec<Arc<PagedDocument>> = self.lock().values().map(|held| Arc::clone(&held.document)).collect();
        for document in documents.iter().filter(|document| document.is_edited()) {
            if let Err(error) = document.save() {
                eprintln!("a large file was not saved on quit: {error}");
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PagedOpened {
    id: u64,
    /// Bytes in the file.
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PagedWindow {
    from: u64,
    to: u64,
    first_line: Option<u64>,
    text: String,
    exact: bool,
}

impl From<Window> for PagedWindow {
    fn from(window: Window) -> Self {
        Self { from: window.from, to: window.to, first_line: window.first_line, text: window.text, exact: window.exact }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PagedProgress {
    indexed_bytes: u64,
    total_bytes: u64,
    lines: u64,
    complete: bool,
}

#[tauri::command(async)]
pub fn paged_open(
    workspace_id: String,
    relative_path: String,
    registry: State<'_, WorkspaceRegistry>,
    documents: State<'_, PagedDocuments>,
) -> Result<PagedOpened, FileError> {
    let path = registry.resolve_workspace_path(&workspace_id, &relative_path)?;
    let (id, document) = documents.hold(&path)?;
    Ok(PagedOpened { id, size: document.size() })
}

#[tauri::command(async)]
pub fn paged_window(id: u64, around: u64, target: usize, documents: State<'_, PagedDocuments>) -> Result<PagedWindow, FileError> {
    Ok(documents.get(id)?.window(around, target.min(LARGEST_WINDOW))?.into())
}

#[tauri::command(async)]
pub fn paged_window_from(id: u64, from: u64, target: usize, documents: State<'_, PagedDocuments>) -> Result<PagedWindow, FileError> {
    Ok(documents.get(id)?.window_from(from, target.min(LARGEST_WINDOW))?.into())
}

#[tauri::command(async)]
pub fn paged_window_before(id: u64, end: u64, target: usize, documents: State<'_, PagedDocuments>) -> Result<PagedWindow, FileError> {
    Ok(documents.get(id)?.window_before(end, target.min(LARGEST_WINDOW))?.into())
}

#[tauri::command(async)]
pub fn paged_progress(id: u64, documents: State<'_, PagedDocuments>) -> Result<PagedProgress, FileError> {
    let progress = documents.get(id)?.progress();
    Ok(PagedProgress { indexed_bytes: progress.indexed_bytes, total_bytes: progress.total_bytes, lines: progress.lines, complete: progress.complete })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PagedSaved {
    size: u64,
    last_modified_ms: i64,
}

fn millis(time: std::time::SystemTime) -> i64 {
    time.duration_since(std::time::UNIX_EPOCH).map_or(0, |since| since.as_millis() as i64)
}

fn saved(document: &PagedDocument, over_changes: bool) -> Result<PagedSaved, FileError> {
    let written = if over_changes { document.save_over_changes() } else { document.save() };
    match written {
        Ok(Saved { size, modified }) => Ok(PagedSaved { size, last_modified_ms: millis(modified) }),
        Err(SaveError::ChangedOnDisk) => Err(FileError::Conflict { latest_last_modified_ms: document.modified_on_disk().map_or(0, millis) }),
        Err(error @ SaveError::TextLost) => Err(error.to_string().into()),
        Err(SaveError::Io(error)) => Err(error.into()),
    }
}

/// Replaces the bytes `[from, to)` of the file's text. Returns its new size.
#[tauri::command(async)]
pub fn paged_edit(id: u64, from: u64, to: u64, text: String, documents: State<'_, PagedDocuments>) -> Result<u64, FileError> {
    Ok(documents.get(id)?.edit(from, to, &text)?)
}

/// Another program changed the file since it was read or saved here.
#[tauri::command(async)]
pub fn paged_changed_on_disk(id: u64, documents: State<'_, PagedDocuments>) -> Result<bool, FileError> {
    Ok(documents.get(id)?.changed_on_disk())
}

/// Writes the file. `over_changes` writes over what another program wrote
/// there since it was read; without it that is a conflict.
#[tauri::command(async)]
pub fn paged_save(id: u64, over_changes: bool, documents: State<'_, PagedDocuments>) -> Result<PagedSaved, FileError> {
    let document = documents.get(id)?;
    saved(&document, over_changes)
}

/// One screen lets go of the file. When it was the last, the file is saved
/// if it has edits, and closed; `discard` closes it without saving, and so
/// does a file that is no longer on disk. A file whose save fails stays
/// open with its edits, so the screen that opens it next finds them. Closing a file that is not open is not an error: the
/// interface closes on unmount, and may do so twice.
#[tauri::command(async)]
pub fn paged_close(id: u64, discard: bool, documents: State<'_, PagedDocuments>) -> Result<(), FileError> {
    let Some(document) = documents.release(id) else { return Ok(()) };
    // A file deleted or moved away is not written back into being.
    let gone = document.modified_on_disk().is_none();
    if !discard && !gone && document.is_edited() {
        saved(&document, false)?;
    }
    // Dropped here, off the lock: dropping waits for the indexing thread.
    drop(documents.forget(id));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn document(text: &str) -> (tempfile::NamedTempFile, PagedDocument) {
        let mut file = tempfile::NamedTempFile::new().expect("temp file");
        file.write_all(text.as_bytes()).expect("write");
        let document = PagedDocument::open(file.path()).expect("open");
        (file, document)
    }

    #[test]
    fn an_open_file_is_found_by_its_id_until_it_is_closed() {
        let documents = PagedDocuments::default();
        let (file, _) = document("# Title\n\ntext\n");
        let (id, _) = documents.hold(file.path()).expect("hold");
        assert_eq!(documents.get(id).expect("get").size(), 14);
        assert!(documents.release(id).is_some());
        assert!(documents.forget(id).is_some());
        assert!(matches!(documents.get(id), Err(FileError::NotFound { .. })));
        assert!(documents.release(id).is_none());
    }

    #[test]
    fn two_screens_on_one_file_share_it_until_both_let_go() {
        let documents = PagedDocuments::default();
        let (file, _) = document("text\n");
        let (first, _) = documents.hold(file.path()).expect("hold");
        let (second, shared) = documents.hold(file.path()).expect("hold");
        assert_eq!(first, second);
        shared.edit(0, 0, "more ").expect("edit");
        assert!(documents.release(first).is_none());
        assert_eq!(documents.get(first).expect("get").size(), 10);
        assert!(documents.release(first).is_some());
    }

    #[test]
    fn a_file_taken_up_again_before_it_is_forgotten_stays_open() {
        let documents = PagedDocuments::default();
        let (file, _) = document("text\n");
        let (id, _) = documents.hold(file.path()).expect("hold");
        assert!(documents.release(id).is_some());
        let (again, _) = documents.hold(file.path()).expect("hold");
        assert_eq!(id, again);
        assert!(documents.forget(id).is_none());
        assert!(documents.get(id).is_ok());
    }

    #[test]
    fn every_edited_file_is_saved_as_the_app_quits() {
        let documents = PagedDocuments::default();
        let (file, _) = document("text\n");
        let (_, held) = documents.hold(file.path()).expect("hold");
        held.edit(0, 0, "more ").expect("edit");
        documents.save_all();
        assert_eq!(std::fs::read_to_string(file.path()).expect("read"), "more text\n");
    }

    #[test]
    fn a_save_over_a_file_another_changed_is_a_conflict() {
        let (file, opened) = document("mine\n");
        opened.edit(0, 0, "more ").expect("edit");
        std::thread::sleep(std::time::Duration::from_millis(20));
        let theirs = file.path().with_extension("theirs");
        std::fs::write(&theirs, "theirs\n").expect("write");
        std::fs::rename(&theirs, file.path()).expect("rename");
        assert!(matches!(saved(&opened, false), Err(FileError::Conflict { latest_last_modified_ms }) if latest_last_modified_ms > 0));
        saved(&opened, true).expect("save over");
        assert_eq!(std::fs::read_to_string(file.path()).expect("read"), "more mine\n");
    }

    #[test]
    fn a_save_says_what_is_on_disk() {
        let (file, opened) = document("text\n");
        opened.edit(4, 4, " more").expect("edit");
        let saved = saved(&opened, false).expect("save");
        assert_eq!(saved.size, 10);
        assert!(saved.last_modified_ms > 0);
        assert_eq!(std::fs::read_to_string(file.path()).expect("read"), "text more\n");
    }

    #[test]
    fn each_open_file_gets_an_id_of_its_own() {
        let documents = PagedDocuments::default();
        let (a, _) = document("a\n");
        let (b, _) = document("b\n");
        assert_ne!(documents.hold(a.path()).expect("hold").0, documents.hold(b.path()).expect("hold").0);
    }

    #[test]
    fn no_more_than_the_limit_are_open_at_once() {
        let documents = PagedDocuments::default();
        let mut files = Vec::new();
        for _ in 0..MOST_OPEN {
            let (file, _) = document("text\n");
            documents.hold(file.path()).expect("hold");
            files.push(file);
        }
        let (one_more, _) = document("text\n");
        assert!(documents.hold(one_more.path()).is_err());
    }

    #[test]
    fn a_window_crosses_to_the_interface_in_its_own_spelling() {
        let window = PagedWindow::from(Window { from: 1, to: 9, first_line: Some(3), text: "text".to_owned(), exact: true });
        assert_eq!(serde_json::to_string(&window).expect("json"), r#"{"from":1,"to":9,"firstLine":3,"text":"text","exact":true}"#);
    }
}
