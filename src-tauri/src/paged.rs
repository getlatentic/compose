//! Files read a window at a time, for the interface.
//!
//! A file too large to hold is opened here and never read whole: the
//! interface asks for the text around a place and is given a window of it.
//! The reading itself is `paged_document`; this is the open files and the
//! commands.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use paged_document::{PagedDocument, Window};
use serde::Serialize;
use tauri::State;

use crate::files::FileError;
use crate::workspace::WorkspaceRegistry;

/// The most files open this way at once. Each holds two file handles and,
/// while its index is built, a thread.
const MOST_OPEN: usize = 16;
/// The most text one window may be asked for.
const LARGEST_WINDOW: usize = 4 * 1024 * 1024;

/// The files open a window at a time, by the id the interface holds.
#[derive(Default)]
pub struct PagedDocuments {
    open: Mutex<HashMap<u64, Arc<PagedDocument>>>,
    last_id: AtomicU64,
}

impl PagedDocuments {
    fn lock(&self) -> MutexGuard<'_, HashMap<u64, Arc<PagedDocument>>> {
        self.open.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn add(&self, document: PagedDocument) -> Result<u64, FileError> {
        let mut open = self.lock();
        if open.len() >= MOST_OPEN {
            return Err(format!("{MOST_OPEN} large files are open already; close one first").into());
        }
        let id = self.last_id.fetch_add(1, Ordering::Relaxed) + 1;
        open.insert(id, Arc::new(document));
        Ok(id)
    }

    /// The document, held outside the lock: a read of the file does not
    /// keep the other open files waiting.
    fn get(&self, id: u64) -> Result<Arc<PagedDocument>, FileError> {
        self.lock().get(&id).cloned().ok_or_else(|| FileError::NotFound { message: format!("no large file is open as {id}") })
    }

    fn remove(&self, id: u64) -> Option<Arc<PagedDocument>> {
        self.lock().remove(&id)
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
    let document = PagedDocument::open(&path)?;
    let size = document.size();
    Ok(PagedOpened { id: documents.add(document)?, size })
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

/// Closing a file that is not open is not an error: the interface closes
/// on unmount, and may do so twice.
#[tauri::command(async)]
pub fn paged_close(id: u64, documents: State<'_, PagedDocuments>) {
    // Dropped here, off the lock: dropping waits for the indexing thread.
    drop(documents.remove(id));
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
        let (_file, opened) = document("# Title\n\ntext\n");
        let id = documents.add(opened).expect("add");
        assert_eq!(documents.get(id).expect("get").size(), 14);
        assert!(documents.remove(id).is_some());
        assert!(matches!(documents.get(id), Err(FileError::NotFound { .. })));
        assert!(documents.remove(id).is_none());
    }

    #[test]
    fn each_open_file_gets_an_id_of_its_own() {
        let documents = PagedDocuments::default();
        let (_a, first) = document("a\n");
        let (_b, second) = document("b\n");
        assert_ne!(documents.add(first).expect("add"), documents.add(second).expect("add"));
    }

    #[test]
    fn no_more_than_the_limit_are_open_at_once() {
        let documents = PagedDocuments::default();
        let mut files = Vec::new();
        for _ in 0..MOST_OPEN {
            let (file, opened) = document("text\n");
            documents.add(opened).expect("add");
            files.push(file);
        }
        let (_file, one_more) = document("text\n");
        assert!(documents.add(one_more).is_err());
    }

    #[test]
    fn a_window_crosses_to_the_interface_in_its_own_spelling() {
        let window = PagedWindow::from(Window { from: 1, to: 9, first_line: Some(3), text: "text".to_owned(), exact: true });
        assert_eq!(serde_json::to_string(&window).expect("json"), r#"{"from":1,"to":9,"firstLine":3,"text":"text","exact":true}"#);
    }
}
