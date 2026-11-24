//! A file on disk, read a window at a time while its index is built.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::JoinHandle;

use crate::index::{Index, IndexBuilder};

/// How much of the file the indexing thread reads at a time.
const CHUNK: usize = 4 * 1024 * 1024;
/// How far a window looks for the end of a line where the index has not
/// reached yet.
const LINE_SEARCH: u64 = 64 * 1024;

/// A piece of the file's text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Window {
    /// The bytes of the file the text covers.
    pub from: u64,
    pub to: u64,
    /// The number of the first line, from 0, where the index knows it.
    pub first_line: Option<u64>,
    pub text: String,
    /// The window starts where a top-level block starts with nothing open
    /// above it, so its text reads as it would after reading the whole file.
    pub exact: bool,
}

/// How far the index has got.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    pub indexed_bytes: u64,
    pub total_bytes: u64,
    pub lines: u64,
    pub complete: bool,
}

pub struct PagedDocument {
    /// One handle for window reads: a read seeks, so they take turns.
    file: Mutex<File>,
    size: u64,
    index: Arc<RwLock<Index>>,
    stop: Arc<AtomicBool>,
    indexing: Mutex<Option<JoinHandle<()>>>,
}

impl PagedDocument {
    /// Opens `path` without reading it, and starts indexing it on a thread
    /// of its own. Windows can be asked for at once.
    pub fn open(path: &Path) -> io::Result<Self> {
        let file = File::open(path)?;
        let size = file.metadata()?.len();
        let index = Arc::new(RwLock::new(Index::default()));
        let stop = Arc::new(AtomicBool::new(false));
        let reader = File::open(path)?;
        let indexing = std::thread::Builder::new().name("paged-document-index".to_owned()).spawn({
            let (index, stop) = (Arc::clone(&index), Arc::clone(&stop));
            move || build_index(reader, &index, &stop)
        })?;
        Ok(Self { file: Mutex::new(file), size, index, stop, indexing: Mutex::new(Some(indexing)) })
    }

    pub fn size(&self) -> u64 {
        self.size
    }

    pub fn progress(&self) -> Progress {
        let index = self.read_index();
        Progress { indexed_bytes: index.indexed_bytes, total_bytes: self.size, lines: index.lines, complete: index.complete }
    }

    /// Blocks until the whole file is indexed. For tools and tests: an
    /// editor shows windows while the index is still being built.
    pub fn wait_until_indexed(&self) {
        if let Some(indexing) = self.indexing.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take() {
            // A panic on the thread leaves the index incomplete; windows
            // past it are still read, as inexact ones.
            let _ = indexing.join();
        }
    }

    /// About `target` bytes of text with the byte `around` in it.
    pub fn window(&self, around: u64, target: usize) -> io::Result<Window> {
        let around = around.min(self.size);
        let (from, first_line, exact) = self.window_start(around, target)?;
        let wanted = (from + target as u64).max(around + 1).min(self.size);
        self.read_window(from, self.window_end(wanted)?, first_line, exact)
    }

    /// About `target` bytes of text that start at the byte `from`, which is
    /// where an earlier window ended.
    pub fn window_from(&self, from: u64, target: usize) -> io::Result<Window> {
        let from = from.min(self.size);
        let start = self.read_index().start_at_or_before(from);
        // Where the earlier window ended at a start the index names, this
        // one is as exact as that start; where it ended at the end of a
        // line the index had not reached, nothing is known of this place.
        let (first_line, exact) = if start.offset == from { (Some(start.line), start.exact) } else { (None, false) };
        let wanted = (from + target as u64).min(self.size);
        self.read_window(from, self.window_end(wanted)?, first_line, exact)
    }

    /// About `target` bytes of text that end at the byte `end`, which is
    /// where an earlier window started.
    pub fn window_before(&self, end: u64, target: usize) -> io::Result<Window> {
        let end = end.min(self.size);
        let (from, first_line, exact) = self.window_start(end.saturating_sub(target as u64), 0)?;
        self.read_window(from, end, first_line, exact)
    }

    /// About `target` bytes of text with line `line` (from 0) in it, as far
    /// as the index has reached; the last indexed text otherwise.
    pub fn window_at_line(&self, line: u64, target: usize) -> io::Result<Window> {
        let start = self.read_index().start_at_or_before_line(line);
        let wanted = (start.offset + target as u64).min(self.size);
        self.read_window(start.offset, self.window_end(wanted)?, Some(start.line), start.exact)
    }

    fn read_index(&self) -> std::sync::RwLockReadGuard<'_, Index> {
        self.index.read().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Where the window with `around` in it starts: at the index's last
    /// start before it, or, where the index has not reached, at the start of
    /// a line near it.
    fn window_start(&self, around: u64, target: usize) -> io::Result<(u64, Option<u64>, bool)> {
        let index = self.read_index();
        if around <= index.indexed_bytes {
            let start = index.start_at_or_before(around);
            return Ok((start.offset, Some(start.line), start.exact));
        }
        drop(index);
        // Near the end of the file the window is the file's last text, not
        // the nothing that follows it.
        let near = around.min(self.size.saturating_sub(target as u64));
        let back = near.saturating_sub(LINE_SEARCH);
        let before = self.read_bytes(back, near)?;
        let line_start = memchr::memrchr(b'\n', &before).map_or(back, |at| back + at as u64 + 1);
        Ok((line_start, None, false))
    }

    fn read_window(&self, from: u64, to: u64, first_line: Option<u64>, exact: bool) -> io::Result<Window> {
        let mut bytes = self.read_bytes(from, to)?;
        // A window cut inside a very long line may end inside a character.
        while std::str::from_utf8(&bytes).is_err_and(|error| error.error_len().is_none()) {
            bytes.pop();
        }
        let to = from + bytes.len() as u64;
        let text = String::from_utf8(bytes).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, format!("bytes {from} to {to} are not UTF-8: {error}")))?;
        Ok(Window { from, to, first_line, text, exact })
    }

    /// Where a window that should reach `wanted` ends: at the index's next
    /// start, or at the end of the line `wanted` is on.
    fn window_end(&self, wanted: u64) -> io::Result<u64> {
        if wanted >= self.size {
            return Ok(self.size);
        }
        if let Some(next) = self.read_index().start_after(wanted - 1) {
            return Ok(next.offset);
        }
        let ahead = self.read_bytes(wanted, (wanted + LINE_SEARCH).min(self.size))?;
        Ok(memchr::memchr(b'\n', &ahead).map_or(wanted, |at| wanted + at as u64 + 1))
    }

    fn read_bytes(&self, from: u64, to: u64) -> io::Result<Vec<u8>> {
        let mut bytes = vec![0; (to - from) as usize];
        let mut file = self.file.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        file.seek(SeekFrom::Start(from))?;
        file.read_exact(&mut bytes)?;
        Ok(bytes)
    }
}

impl Drop for PagedDocument {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.wait_until_indexed();
    }
}

/// Reads the file once, publishing the starts found after each chunk.
fn build_index(mut file: File, shared: &RwLock<Index>, stop: &AtomicBool) {
    let mut builder = IndexBuilder::default();
    let mut chunk = vec![0; CHUNK];
    let mut published = 0;
    loop {
        if stop.load(Ordering::Relaxed) {
            return;
        }
        match file.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => builder.feed(&chunk[..read]),
            // The index stays where it got to: windows past it are inexact.
            Err(_) => return,
        }
        published = publish(shared, builder.index(), published);
    }
    let complete = builder.finish();
    publish(shared, &complete, published);
}

/// Adds the starts found since the last time to the shared index. Returns
/// how many are published now.
fn publish(shared: &RwLock<Index>, found: &Index, published: usize) -> usize {
    let mut index = shared.write().unwrap_or_else(|poisoned| poisoned.into_inner());
    index.extend(found, published);
    found.checkpoints().len()
}
