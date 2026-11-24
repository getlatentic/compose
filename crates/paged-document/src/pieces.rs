//! The text of a document as pieces: runs of the file on disk, and text
//! added since it was opened.
//!
//! An edit never moves the text around it. It cuts the piece it lands in and
//! puts the new text between the halves, so an edit costs the same in a file
//! of any size, and the file itself is read only where a piece of it is
//! asked for.

use std::fs::File;
use std::io::{self, Write};
use std::sync::Arc;

/// A run of the document's text.
#[derive(Clone)]
enum Piece {
    /// Bytes of the file as it was opened, from `start`.
    File { start: u64, len: u64 },
    /// Text added by an edit: `len` bytes of `text` from `start`. Shared, so
    /// a save can write from the pieces as they were when it began.
    Added { text: Arc<[u8]>, start: usize, len: u64 },
}

impl Piece {
    fn len(&self) -> u64 {
        match self {
            Piece::File { len, .. } | Piece::Added { len, .. } => *len,
        }
    }

    /// The part of the piece from `skip` bytes in, `len` bytes long.
    fn part(&self, skip: u64, len: u64) -> Piece {
        match self {
            Piece::File { start, .. } => Piece::File { start: start + skip, len },
            Piece::Added { text, start, .. } => Piece::Added { text: Arc::clone(text), start: start + skip as usize, len },
        }
    }
}

/// The most text joined into one added piece. An edit copies no more.
const LARGEST_JOINED: u64 = 64 * 1024;

#[derive(Clone)]
pub(crate) struct Pieces {
    pieces: Vec<Piece>,
    len: u64,
}

impl Pieces {
    /// The pieces of a file of `len` bytes that has not been edited.
    pub(crate) fn of_file(len: u64) -> Self {
        let pieces = if len == 0 { Vec::new() } else { vec![Piece::File { start: 0, len }] };
        Self { pieces, len }
    }

    pub(crate) fn len(&self) -> u64 {
        self.len
    }

    /// Replaces the bytes `[from, to)` of the document by `text`.
    pub(crate) fn edit(&mut self, from: u64, to: u64, text: &[u8]) {
        let (from, to) = (from.min(self.len), to.clamp(from.min(self.len), self.len));
        let first = self.cut_at(from);
        let after = self.cut_at(to);
        let added = (!text.is_empty()).then(|| Piece::Added { text: Arc::from(text), start: 0, len: text.len() as u64 });
        let has_added = added.is_some();
        self.pieces.splice(first..after, added);
        self.len = self.len - (to - from) + text.len() as u64;
        if has_added {
            self.join_added_around(first);
        }
    }

    /// Joins the added piece `number` to added pieces beside it while the
    /// whole stays small: typing in one place makes one piece, not one for
    /// each key.
    fn join_added_around(&mut self, number: usize) {
        let mut first = number;
        let mut last = number;
        let mut len = self.pieces[number].len();
        while first > 0 && self.joins(first - 1, len) {
            first -= 1;
            len += self.pieces[first].len();
        }
        while last + 1 < self.pieces.len() && self.joins(last + 1, len) {
            last += 1;
            len += self.pieces[last].len();
        }
        if first == last {
            return;
        }
        let mut text = Vec::with_capacity(len as usize);
        for piece in &self.pieces[first..=last] {
            if let Piece::Added { text: run, start, len } = piece {
                text.extend_from_slice(&run[*start..*start + *len as usize]);
            }
        }
        self.pieces.splice(first..=last, [Piece::Added { text: Arc::from(text), start: 0, len }]);
    }

    /// Piece `number` is added text that fits in a joined piece with `len`
    /// more bytes.
    fn joins(&self, number: usize, len: u64) -> bool {
        matches!(&self.pieces[number], Piece::Added { len: own, .. } if own + len <= LARGEST_JOINED)
    }

    /// Makes `at` the start of a piece, cutting the piece it is inside.
    /// Returns the number of that piece, or of pieces when `at` is the end.
    fn cut_at(&mut self, at: u64) -> usize {
        let mut start = 0;
        for number in 0..self.pieces.len() {
            let len = self.pieces[number].len();
            if at == start {
                return number;
            }
            if at < start + len {
                let piece = self.pieces[number].clone();
                self.pieces[number] = piece.part(0, at - start);
                self.pieces.insert(number + 1, piece.part(at - start, len - (at - start)));
                return number + 1;
            }
            start += len;
        }
        self.pieces.len()
    }

    /// Gives `take` each run of the bytes `[from, to)`, in order. The runs
    /// of the file are read from `file` as they come.
    fn runs(&self, from: u64, to: u64, file: &File, take: &mut dyn FnMut(&[u8]) -> io::Result<()>) -> io::Result<()> {
        let mut start = 0;
        let mut buffer = Vec::new();
        for piece in &self.pieces {
            let end = start + piece.len();
            if end > from && start < to {
                let skip = from.saturating_sub(start);
                let len = end.min(to) - start - skip;
                match piece.part(skip, len) {
                    Piece::Added { text, start, len } => take(&text[start..start + len as usize])?,
                    Piece::File { start, len } => read_file_run(file, start, len, &mut buffer, take)?,
                }
            }
            start = end;
            if start >= to {
                break;
            }
        }
        Ok(())
    }

    /// The bytes `[from, to)` of the document.
    pub(crate) fn read(&self, from: u64, to: u64, file: &File) -> io::Result<Vec<u8>> {
        let to = to.min(self.len);
        let mut bytes = Vec::with_capacity(to.saturating_sub(from) as usize);
        self.runs(from, to, file, &mut |run| {
            bytes.extend_from_slice(run);
            Ok(())
        })?;
        Ok(bytes)
    }

    /// Writes the whole document to `out`, a run at a time.
    pub(crate) fn write_to(&self, file: &File, out: &mut dyn Write) -> io::Result<()> {
        self.runs(0, self.len, file, &mut |run| out.write_all(run))
    }
}

/// The most of the file read at once for one run.
const LARGEST_READ: usize = 1024 * 1024;

fn read_file_run(file: &File, start: u64, len: u64, buffer: &mut Vec<u8>, take: &mut dyn FnMut(&[u8]) -> io::Result<()>) -> io::Result<()> {
    let mut done = 0;
    while done < len {
        let now = ((len - done) as usize).min(LARGEST_READ);
        buffer.resize(now, 0);
        read_exact_at(file, buffer, start + done)?;
        take(buffer)?;
        done += now as u64;
    }
    Ok(())
}

/// Fills `buffer` from the byte `offset` of `file`, wherever the file's own
/// cursor is: a window is read while the index and a save read elsewhere.
#[cfg(unix)]
fn read_exact_at(file: &File, buffer: &mut [u8], offset: u64) -> io::Result<()> {
    std::os::unix::fs::FileExt::read_exact_at(file, buffer, offset)
}

#[cfg(windows)]
fn read_exact_at(file: &File, buffer: &mut [u8], offset: u64) -> io::Result<()> {
    use std::os::windows::fs::FileExt;
    let mut done = 0;
    while done < buffer.len() {
        match file.seek_read(&mut buffer[done..], offset + done as u64)? {
            0 => return Err(io::ErrorKind::UnexpectedEof.into()),
            read => done += read,
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn on_disk(text: &str) -> (tempfile::NamedTempFile, File) {
        let mut file = tempfile::NamedTempFile::new().expect("temp file");
        file.write_all(text.as_bytes()).expect("write");
        let reader = File::open(file.path()).expect("open");
        (file, reader)
    }

    fn text_of(pieces: &Pieces, file: &File) -> String {
        String::from_utf8(pieces.read(0, pieces.len(), file).expect("read")).expect("utf-8")
    }

    #[test]
    fn an_unedited_document_is_the_file() {
        let (_file, reader) = on_disk("hello world");
        let pieces = Pieces::of_file(11);
        assert_eq!(text_of(&pieces, &reader), "hello world");
        assert_eq!(pieces.read(6, 11, &reader).expect("read"), b"world");
    }

    #[test]
    fn an_edit_replaces_its_range_and_leaves_the_rest() {
        let (_file, reader) = on_disk("hello world");
        let mut pieces = Pieces::of_file(11);
        pieces.edit(6, 11, b"there");
        assert_eq!(text_of(&pieces, &reader), "hello there");
        pieces.edit(0, 0, b">> ");
        pieces.edit(9, 10, b"");
        assert_eq!(text_of(&pieces, &reader), ">> hello here");
        assert_eq!(pieces.len(), 13);
    }

    #[test]
    fn many_random_edits_give_the_text_a_string_gives() {
        let original = "The quick brown fox jumps over the lazy dog. ".repeat(40);
        let (_file, reader) = on_disk(&original);
        let mut pieces = Pieces::of_file(original.len() as u64);
        let mut model = original.clone().into_bytes();
        let mut state = 0x2545_F491_4F6C_DD1Du64;
        let mut next = |below: usize| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state % below.max(1) as u64) as usize
        };
        for step in 0..2000 {
            let from = next(model.len() + 1);
            let to = (from + next(12)).min(model.len());
            let text = format!("<{step}>");
            let text = if next(3) == 0 { "" } else { &text };
            pieces.edit(from as u64, to as u64, text.as_bytes());
            model.splice(from..to, text.bytes());
            assert_eq!(pieces.len(), model.len() as u64);
            if step % 50 == 0 {
                assert_eq!(pieces.read(0, pieces.len(), &reader).expect("read"), model, "step {step}");
                let (a, b) = (next(model.len() + 1), next(model.len() + 1));
                let (a, b) = (a.min(b), a.max(b));
                assert_eq!(pieces.read(a as u64, b as u64, &reader).expect("read"), &model[a..b]);
            }
        }
        let mut written = Vec::new();
        pieces.write_to(&reader, &mut written).expect("write");
        assert_eq!(written, model);
    }
}
