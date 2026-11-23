//! A file on disk, read and edited a window at a time.
//!
//! The file is opened and not read. Its text is held as pieces (`pieces.rs`),
//! so an edit costs the same at any size. One thread reads the text to find
//! where windows may start (`index.rs`), from the top when the file opens and
//! again from just above each edit, and stops reading as soon as what it
//! finds meets what it found before.

use std::collections::VecDeque;
use std::fs::File;
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::thread::JoinHandle;
use std::time::{Duration, SystemTime};

use crate::index::{Checkpoint, IndexBuilder, LONGEST_GAP};
use crate::pieces::Pieces;

/// How much text the indexing thread reads at a time. It holds the document
/// for that long, so windows and edits wait at most one read of this.
const CHUNK: u64 = 256 * 1024;
/// How far a window looks for the end of a line where the index has not
/// reached yet.
const LINE_SEARCH: u64 = 64 * 1024;

/// A piece of the document's text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Window {
    /// The bytes of the document the text covers.
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

/// What a save left on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Saved {
    pub size: u64,
    pub modified: SystemTime,
}

#[derive(Debug)]
pub enum SaveError {
    /// The file on disk is not the one this document last read or wrote.
    ChangedOnDisk,
    Io(io::Error),
}

impl From<io::Error> for SaveError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl std::fmt::Display for SaveError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SaveError::ChangedOnDisk => write!(formatter, "the file changed on disk since it was opened"),
            SaveError::Io(error) => write!(formatter, "{error}"),
        }
    }
}

/// The document's text and what is known of where windows may start in it.
struct State {
    /// The file the pieces' runs are read from: the one opened, until a save
    /// with no edit since replaces it by the one written.
    file: Arc<File>,
    pieces: Pieces,
    /// The starts found, as far as the text has been read since the last
    /// edit above that place.
    builder: IndexBuilder,
    /// Starts found before an edit, beyond where the text has been read
    /// again. Each is trusted once the reading reaches it and finds a clean
    /// start there too.
    candidates: VecDeque<Checkpoint>,
    /// Where edits were made beyond where the text has been read again,
    /// ascending. Candidates are not taken across one without reading.
    edited_at: Vec<u64>,
    /// Counts edits: a save knows by it whether the text changed as it wrote.
    version: u64,
    saved_version: u64,
    /// The file on disk as this document last read or wrote it.
    on_disk: Option<SystemTime>,
}

pub struct PagedDocument {
    path: PathBuf,
    state: Arc<RwLock<State>>,
    stop: Arc<AtomicBool>,
    indexing: Mutex<Option<JoinHandle<()>>>,
}

fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|metadata| metadata.modified()).ok()
}

impl PagedDocument {
    /// Opens `path` without reading it, and starts indexing it on a thread
    /// of its own. Windows can be asked for at once.
    pub fn open(path: &Path) -> io::Result<Self> {
        let file = File::open(path)?;
        let size = file.metadata()?.len();
        let state = Arc::new(RwLock::new(State {
            file: Arc::new(file),
            pieces: Pieces::of_file(size),
            builder: IndexBuilder::default(),
            candidates: VecDeque::new(),
            edited_at: Vec::new(),
            version: 0,
            saved_version: 0,
            on_disk: modified(path),
        }));
        let stop = Arc::new(AtomicBool::new(false));
        let indexing = std::thread::Builder::new().name("paged-document-index".to_owned()).spawn({
            let (state, stop) = (Arc::clone(&state), Arc::clone(&stop));
            move || keep_indexed(&state, &stop)
        })?;
        Ok(Self { path: path.to_owned(), state, stop, indexing: Mutex::new(Some(indexing)) })
    }

    /// Bytes in the document as it stands, edits included.
    pub fn size(&self) -> u64 {
        self.read().pieces.len()
    }

    /// The document has edits that are not on disk.
    pub fn is_edited(&self) -> bool {
        let state = self.read();
        state.version != state.saved_version
    }

    pub fn progress(&self) -> Progress {
        let state = self.read();
        let index = state.builder.index();
        Progress { indexed_bytes: index.indexed_bytes, total_bytes: state.pieces.len(), lines: index.lines, complete: index.complete }
    }

    /// Blocks until the whole text is indexed. For tools and tests: an
    /// editor shows windows while the index is still being built.
    pub fn wait_until_indexed(&self) {
        while !self.progress().complete && !self.stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    /// About `target` bytes of text with the byte `around` in it.
    pub fn window(&self, around: u64, target: usize) -> io::Result<Window> {
        let state = self.read();
        let around = around.min(state.pieces.len());
        let (from, first_line, exact) = state.window_start(around, target)?;
        let wanted = (from + target as u64).max(around + 1).min(state.pieces.len());
        state.read_window(from, state.window_end(wanted)?, first_line, exact)
    }

    /// About `target` bytes of text that start at the byte `from`, which is
    /// where an earlier window ended.
    pub fn window_from(&self, from: u64, target: usize) -> io::Result<Window> {
        let state = self.read();
        let from = from.min(state.pieces.len());
        // Where the earlier window ended at a start the index names, this
        // one is as exact as that start; anywhere else, nothing is known of
        // this place.
        let start = state.builder.index().start_at_or_before(from);
        let known = start.offset == from && from <= state.builder.position();
        let (first_line, exact) = if known { (Some(start.line), start.exact) } else { (None, false) };
        let wanted = (from + target as u64).min(state.pieces.len());
        state.read_window(from, state.window_end(wanted)?, first_line, exact)
    }

    /// About `target` bytes of text that end at the byte `end`, which is
    /// where an earlier window started.
    pub fn window_before(&self, end: u64, target: usize) -> io::Result<Window> {
        let state = self.read();
        let end = end.min(state.pieces.len());
        let (from, first_line, exact) = state.window_start(end.saturating_sub(target as u64), 0)?;
        state.read_window(from, end, first_line, exact)
    }

    /// About `target` bytes of text with line `line` (from 0) in it, as far
    /// as the index has reached; the last indexed text otherwise.
    pub fn window_at_line(&self, line: u64, target: usize) -> io::Result<Window> {
        let state = self.read();
        let start = state.builder.index().start_at_or_before_line(line);
        let wanted = (start.offset + target as u64).min(state.pieces.len());
        state.read_window(start.offset, state.window_end(wanted)?, Some(start.line), start.exact)
    }

    /// Replaces the bytes `[from, to)` of the document by `text`. Returns
    /// the document's new size. The places must not be inside a character.
    pub fn edit(&self, from: u64, to: u64, text: &str) -> io::Result<u64> {
        let size = loop {
            // The places are checked against the file before the document
            // is held for the edit, and checked again if it changed between.
            let checked = {
                let state = self.read();
                state.check_edit(from, to)?;
                state.version
            };
            let mut state = self.write();
            if state.version != checked {
                continue;
            }
            state.edited(from, to, text.len() as u64);
            state.pieces.edit(from, to, text.as_bytes());
            state.version += 1;
            break state.pieces.len();
        };
        self.wake_indexing();
        Ok(size)
    }

    /// Writes the document to its file. The text is written beside the file
    /// and put in its place in one step, so the file is never half written.
    /// Edits made while it is written are kept, and are not in what it wrote.
    pub fn save(&self) -> Result<Saved, SaveError> {
        let (pieces, file, version, on_disk) = {
            let state = self.read();
            (state.pieces.clone(), Arc::clone(&state.file), state.version, state.on_disk)
        };
        if modified(&self.path) != on_disk {
            return Err(SaveError::ChangedOnDisk);
        }
        let beside = beside(&self.path);
        let written = write_beside(&pieces, &file, &self.path, &beside);
        if written.is_err() {
            // Best effort: the file itself was not touched.
            let _ = std::fs::remove_file(&beside);
        }
        written?;
        let saved_file = File::open(&self.path)?;
        let metadata = saved_file.metadata()?;
        let saved = Saved { size: metadata.len(), modified: metadata.modified()? };
        let mut state = self.write();
        state.on_disk = Some(saved.modified);
        state.saved_version = version;
        // With no edit since, the text is the new file from end to end. With
        // one, the pieces go on reading the file that was replaced: it is
        // there as long as it is held open.
        if state.version == version {
            state.file = Arc::new(saved_file);
            state.pieces = Pieces::of_file(saved.size);
        }
        Ok(saved)
    }

    #[cfg(test)]
    pub(crate) fn index(&self) -> crate::index::Index {
        self.read().builder.index().clone()
    }

    fn read(&self) -> RwLockReadGuard<'_, State> {
        self.state.read().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn write(&self) -> RwLockWriteGuard<'_, State> {
        self.state.write().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn wake_indexing(&self) {
        if let Some(indexing) = self.indexing.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).as_ref() {
            indexing.thread().unpark();
        }
    }
}

impl Drop for PagedDocument {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.wake_indexing();
        if let Some(indexing) = self.indexing.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take() {
            // A panic on the thread has left the index where it got to.
            let _ = indexing.join();
        }
    }
}

/// The name the text is written under before it takes the file's place: in
/// the same folder, so the move is within one disk, and hidden.
fn beside(path: &Path) -> PathBuf {
    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    path.with_file_name(format!(".{name}.compose-saving"))
}

fn write_beside(pieces: &Pieces, file: &File, path: &Path, beside: &Path) -> io::Result<()> {
    let out = File::create(beside)?;
    if let Ok(metadata) = std::fs::metadata(path) {
        out.set_permissions(metadata.permissions())?;
    }
    let mut writer = BufWriter::with_capacity(1024 * 1024, out);
    pieces.write_to(file, &mut writer)?;
    writer.flush()?;
    writer.get_ref().sync_all()?;
    std::fs::rename(beside, path)
}

impl State {
    fn read_bytes(&self, from: u64, to: u64) -> io::Result<Vec<u8>> {
        self.pieces.read(from, to, &self.file)
    }

    fn check_edit(&self, from: u64, to: u64) -> io::Result<()> {
        let len = self.pieces.len();
        if from > to || to > len {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, format!("an edit of bytes {from} to {to} is outside a document of {len}")));
        }
        for place in [from, to] {
            if self.is_inside_a_character(place)? {
                return Err(io::Error::new(io::ErrorKind::InvalidInput, format!("byte {place} is inside a character")));
            }
        }
        Ok(())
    }

    /// `place` is at a continuation byte of a UTF-8 character.
    fn is_inside_a_character(&self, place: u64) -> io::Result<bool> {
        if place == 0 || place >= self.pieces.len() {
            return Ok(false);
        }
        Ok(self.read_bytes(place, place + 1)?[0] & 0xC0 == 0x80)
    }

    /// The last candidate at or before `offset`.
    fn candidate_at_or_before(&self, offset: u64) -> Option<Checkpoint> {
        let after = self.candidates.partition_point(|candidate| candidate.offset <= offset);
        after.checked_sub(1).map(|at| self.candidates[at])
    }

    /// Where the window with `around` in it starts: at the index's last
    /// start before it; beyond where the index has read, at a start found
    /// before an edit, or at the start of a line near the place. `target`
    /// keeps a window at the end of the text from being empty.
    fn window_start(&self, around: u64, target: usize) -> io::Result<(u64, Option<u64>, bool)> {
        if around <= self.builder.position() {
            let start = self.builder.index().start_at_or_before(around);
            return Ok((start.offset, Some(start.line), start.exact));
        }
        if let Some(candidate) = self.candidate_at_or_before(around).filter(|candidate| around - candidate.offset <= 2 * LONGEST_GAP) {
            return Ok((candidate.offset, None, false));
        }
        let near = around.min(self.pieces.len().saturating_sub(target as u64));
        let back = near.saturating_sub(LINE_SEARCH);
        let before = self.read_bytes(back, near)?;
        let line_start = memchr::memrchr(b'\n', &before).map_or(back, |at| back + at as u64 + 1);
        Ok((line_start, None, false))
    }

    /// Where a window that should reach `wanted` ends: at the next start
    /// known, or at the end of the line `wanted` is on.
    fn window_end(&self, wanted: u64) -> io::Result<u64> {
        let len = self.pieces.len();
        if wanted >= len {
            return Ok(len);
        }
        let read = self.builder.position();
        if let Some(next) = self.builder.index().start_after(wanted - 1).filter(|next| next.offset <= read) {
            return Ok(next.offset);
        }
        // Read to its end, the text has no start below: the window is the
        // rest of it.
        if read >= len {
            return Ok(len);
        }
        let after = self.candidates.partition_point(|candidate| candidate.offset < wanted);
        if let Some(next) = self.candidates.get(after).filter(|next| next.offset - wanted <= LONGEST_GAP) {
            return Ok(next.offset);
        }
        let ahead = self.read_bytes(wanted, (wanted + LINE_SEARCH).min(len))?;
        Ok(memchr::memchr(b'\n', &ahead).map_or(wanted, |at| wanted + at as u64 + 1))
    }

    fn read_window(&self, from: u64, to: u64, first_line: Option<u64>, exact: bool) -> io::Result<Window> {
        let mut bytes = self.read_bytes(from, to.max(from))?;
        // A window cut inside a very long line may end inside a character.
        while std::str::from_utf8(&bytes).is_err_and(|error| error.error_len().is_none()) {
            bytes.pop();
        }
        let to = from + bytes.len() as u64;
        let text = String::from_utf8(bytes).map_err(|error| io::Error::new(io::ErrorKind::InvalidData, format!("bytes {from} to {to} are not UTF-8: {error}")))?;
        Ok(Window { from, to, first_line, text, exact })
    }

    /// The bytes `[from, to)` are about to be replaced by `added` bytes.
    /// What the index knows from the line of the edit on is no longer
    /// known: the text is read again from the last exact start above that
    /// line. The starts below are kept as candidates, moved with the text.
    fn edited(&mut self, from: u64, to: u64, added: u64) {
        if from <= self.builder.position() {
            let above = self.builder.index().exact_start_above_the_line_of(from);
            let forgotten = self.builder.restart_at(above);
            for start in forgotten.into_iter().rev() {
                self.candidates.push_front(start);
            }
        }
        // The last exact candidate at or before the edit may be on the
        // edited line: it and what follows it up to the edit are dropped,
        // as are the candidates inside the text replaced.
        let upto = self.candidates.partition_point(|candidate| candidate.offset <= from);
        let kept = self.candidates.iter().take(upto).rposition(|candidate| candidate.exact).unwrap_or(upto);
        let below = self.candidates.partition_point(|candidate| candidate.offset < to.max(from + 1));
        self.candidates.drain(kept..below);
        let moved = |offset: u64| if offset <= from { offset } else { offset - (to - from) + added };
        for candidate in &mut self.candidates {
            candidate.offset = moved(candidate.offset);
        }
        self.edited_at.retain(|offset| *offset <= from || *offset >= to);
        for offset in &mut self.edited_at {
            *offset = moved(*offset);
        }
        if let Err(at) = self.edited_at.binary_search(&from) {
            self.edited_at.insert(at, from);
        }
    }

    /// The next stretch of text the index is to read, and the version of
    /// the document it is from. None at the end of the text.
    fn next_to_index(&self) -> io::Result<Option<(u64, Vec<u8>)>> {
        let at = self.builder.position();
        let len = self.pieces.len();
        if at >= len {
            return Ok(None);
        }
        Ok(Some((self.version, self.read_bytes(at, (at + CHUNK).min(len))?)))
    }

    /// The whole text is read.
    fn end_index(&mut self) {
        self.builder.end_text();
        self.candidates.clear();
        self.edited_at.clear();
    }

    /// Takes `bytes`, the text at the place the index has read to.
    fn index(&mut self, bytes: &[u8]) {
        let State { builder, candidates, edited_at, .. } = self;
        let mut met: Option<(Checkpoint, u64)> = None;
        builder.feed_lines(bytes, &mut |line| {
            // What the reading has passed is known now, or was wrong.
            while candidates.front().is_some_and(|candidate| candidate.offset < line.offset) {
                candidates.pop_front();
            }
            edited_at.retain(|offset| *offset >= line.offset);
            let Some(candidate) = candidates.front().copied().filter(|candidate| candidate.offset == line.offset) else { return false };
            if line.clean && candidate.exact {
                met = Some((candidate, line.line));
                return true;
            }
            candidates.pop_front();
            false
        });
        if let Some((candidate, line)) = met {
            self.take_candidates_from(candidate, line);
        }
    }

    /// The reading has reached `met`, a start found before an edit, and
    /// found a clean start there too, at line `line`. From a clean start the
    /// text reads the same whatever is above it, so the starts found below
    /// it still hold, as far as the next edit. They are taken as they are,
    /// and the reading goes on from the last of them.
    fn take_candidates_from(&mut self, met: Checkpoint, line: u64) {
        let here = Checkpoint { offset: met.offset, line, exact: true };
        self.builder.restart_at(here);
        self.builder.add_start(here);
        self.candidates.pop_front();
        // An edit at the start met is in its line, which was just read.
        let next_edit = self.edited_at.iter().copied().find(|offset| *offset > met.offset).unwrap_or(u64::MAX);
        let mut resume = here;
        // A start taken only to bound a window is kept when an exact one
        // follows it: the reading goes on from an exact one.
        let mut held: Vec<Checkpoint> = Vec::new();
        while let Some(next) = self.candidates.front().copied().filter(|next| next.offset < next_edit) {
            self.candidates.pop_front();
            let moved = Checkpoint { line: line + (next.line - met.line), ..next };
            held.push(moved);
            if moved.exact {
                for start in held.drain(..) {
                    self.builder.add_start(start);
                }
                resume = moved;
            }
        }
        self.builder.restart_at(resume);
    }
}

/// Keeps the index up with the text: reads until all of it is read, then
/// sleeps until an edit wakes it. The text is read from the file with the
/// document free for windows and edits, and taken only if no edit came in
/// between.
fn keep_indexed(state: &RwLock<State>, stop: &AtomicBool) {
    while !stop.load(Ordering::Relaxed) {
        let next = state.read().unwrap_or_else(|poisoned| poisoned.into_inner()).next_to_index();
        let mut state = state.write().unwrap_or_else(|poisoned| poisoned.into_inner());
        match next {
            Ok(Some((version, bytes))) if state.version == version => state.index(&bytes),
            Ok(Some(_)) => {}
            Ok(None) if state.builder.position() >= state.pieces.len() => {
                state.end_index();
                drop(state);
                std::thread::park();
            }
            Ok(None) => {}
            // A read that failed leaves the index where it got to: windows
            // past it are inexact. An edit wakes the thread to try again.
            Err(_) => {
                drop(state);
                std::thread::park();
            }
        }
    }
}
