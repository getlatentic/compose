//! The places in a file where a window may start, found in one pass over it.

use crate::scan::{LineScanner, LINE_PREFIX};

/// About how far apart the starts of windows are kept.
pub(crate) const SPACING: u64 = 64 * 1024;
/// Past this much text with no clean start, a start is taken anyway, so a
/// window stays bounded whatever the file holds.
pub(crate) const LONGEST_GAP: u64 = 4 * 1024 * 1024;

/// A place a window may start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Checkpoint {
    /// The byte the window starts at.
    pub offset: u64,
    /// The number of the line that byte is on, from 0.
    pub line: u64,
    /// A top-level block starts here with nothing open above it: the text
    /// below reads as it would after reading the whole file. Not so for a
    /// start taken only to keep a window bounded.
    pub exact: bool,
}

/// The starts found so far, and how much of the file they cover.
#[derive(Debug, Clone, Default)]
pub struct Index {
    checkpoints: Vec<Checkpoint>,
    /// Bytes of the file read so far.
    pub indexed_bytes: u64,
    /// Lines ended so far.
    pub lines: u64,
    pub complete: bool,
}

impl Index {
    pub fn checkpoints(&self) -> &[Checkpoint] {
        &self.checkpoints
    }

    /// The last start at or before `offset`. The start of the file is one.
    pub fn start_at_or_before(&self, offset: u64) -> Checkpoint {
        let after = self.checkpoints.partition_point(|checkpoint| checkpoint.offset <= offset);
        after.checked_sub(1).map_or(START_OF_FILE, |at| self.checkpoints[at])
    }

    /// The first start after `offset`, if the index has reached one.
    pub fn start_after(&self, offset: u64) -> Option<Checkpoint> {
        let after = self.checkpoints.partition_point(|checkpoint| checkpoint.offset <= offset);
        self.checkpoints.get(after).copied()
    }

    /// Takes over what `found` holds beyond its first `known` starts.
    pub(crate) fn extend(&mut self, found: &Index, known: usize) {
        self.checkpoints.extend_from_slice(&found.checkpoints[known..]);
        self.indexed_bytes = found.indexed_bytes;
        self.lines = found.lines;
        self.complete = found.complete;
    }

    /// The last start at or before line `line`.
    pub fn start_at_or_before_line(&self, line: u64) -> Checkpoint {
        let after = self.checkpoints.partition_point(|checkpoint| checkpoint.line <= line);
        after.checked_sub(1).map_or(START_OF_FILE, |at| self.checkpoints[at])
    }
}

const START_OF_FILE: Checkpoint = Checkpoint { offset: 0, line: 0, exact: true };

/// Builds an [`Index`] from the bytes of a file, given in order and in pieces
/// of any size. It keeps the start of the line it is in and nothing else.
#[derive(Default)]
pub(crate) struct IndexBuilder {
    scanner: LineScanner,
    index: Index,
    /// The first bytes of the line being read.
    prefix: Vec<u8>,
    /// Where that line starts, and how long it is so far.
    line_start: u64,
    line_len: u64,
    last_start: u64,
}

impl IndexBuilder {
    pub(crate) fn index(&self) -> &Index {
        &self.index
    }

    pub(crate) fn feed(&mut self, mut bytes: &[u8]) {
        while !bytes.is_empty() {
            match memchr::memchr(b'\n', bytes) {
                Some(end) => {
                    self.line_text(&bytes[..end]);
                    self.end_line();
                    bytes = &bytes[end + 1..];
                }
                None => {
                    self.line_text(bytes);
                    bytes = &[];
                }
            }
        }
    }

    /// The file has ended; a last line without a line break is a line.
    pub(crate) fn finish(mut self) -> Index {
        if self.line_len > 0 {
            self.end_line_at(self.line_start + self.line_len);
        }
        self.index.complete = true;
        self.index
    }

    /// More text of the line being read. A line longer than the longest gap
    /// is cut where a character starts, so no window has to hold all of it.
    fn line_text(&mut self, text: &[u8]) {
        let room = LINE_PREFIX.saturating_sub(self.prefix.len());
        self.prefix.extend_from_slice(&text[..text.len().min(room)]);
        let before = self.line_start + self.line_len;
        self.line_len += text.len() as u64;
        self.index.indexed_bytes = before + text.len() as u64;
        let since_last = before.saturating_sub(self.last_start);
        if since_last + (text.len() as u64) < LONGEST_GAP {
            return;
        }
        let cut = (LONGEST_GAP - since_last.min(LONGEST_GAP)) as usize;
        if let Some(at) = (cut..text.len()).find(|at| is_char_start(text[*at])) {
            self.start_window(before + at as u64, false);
        }
    }

    fn end_line(&mut self) {
        self.end_line_at(self.line_start + self.line_len + 1);
    }

    fn end_line_at(&mut self, next_line: u64) {
        let whole = self.line_len as usize <= self.prefix.len();
        let clean = self.scanner.line(&self.prefix, whole);
        // A long line may have been cut after its start: then the last
        // start is below this line's, and this line starts no window.
        let since_last = self.line_start.saturating_sub(self.last_start);
        let far_enough = since_last >= SPACING;
        let too_far = since_last >= LONGEST_GAP;
        if self.line_start > 0 && ((clean && far_enough) || too_far) {
            self.start_window(self.line_start, clean);
        }
        self.index.lines += 1;
        self.index.indexed_bytes = next_line;
        self.line_start = next_line;
        self.line_len = 0;
        self.prefix.clear();
    }

    fn start_window(&mut self, offset: u64, exact: bool) {
        self.index.checkpoints.push(Checkpoint { offset, line: self.index.lines, exact });
        self.last_start = offset;
    }
}

/// Not a continuation byte of a UTF-8 character.
fn is_char_start(byte: u8) -> bool {
    byte & 0xC0 != 0x80
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index_of(text: &[u8], piece: usize) -> Index {
        let mut builder = IndexBuilder::default();
        for chunk in text.chunks(piece) {
            builder.feed(chunk);
        }
        builder.finish()
    }

    fn sections(count: usize) -> String {
        (0..count).map(|n| format!("## Section {n}\n\nA paragraph of text for section {n}, long enough to add up.\n\n- item\n- item\n\n```\ncode {n}\n\nmore\n```\n\n")).collect()
    }

    #[test]
    fn starts_are_about_a_spacing_apart_and_each_begins_a_line() {
        let text = sections(20_000);
        let index = index_of(text.as_bytes(), 1 << 16);
        assert!(index.complete);
        assert_eq!(index.indexed_bytes, text.len() as u64);
        assert_eq!(index.lines as usize, text.matches('\n').count());
        let starts = index.checkpoints();
        assert!(starts.len() > 20, "{} starts", starts.len());
        for pair in starts.windows(2) {
            let gap = pair[1].offset - pair[0].offset;
            assert!((SPACING..SPACING + 1024).contains(&gap), "gap {gap}");
        }
        for start in starts {
            assert!(start.exact);
            assert_eq!(text.as_bytes()[start.offset as usize - 1], b'\n');
            assert_eq!(text[..start.offset as usize].matches('\n').count() as u64, start.line);
            assert!(text[start.offset as usize..].starts_with("## Section") || text[start.offset as usize..].starts_with("A paragraph") || text[start.offset as usize..].starts_with("```"));
        }
    }

    #[test]
    fn the_pieces_the_file_arrives_in_do_not_change_the_index() {
        let text = sections(5_000);
        let whole = index_of(text.as_bytes(), text.len());
        for piece in [1, 7, 4096, 65_537] {
            assert_eq!(index_of(text.as_bytes(), piece).checkpoints(), whole.checkpoints(), "pieces of {piece}");
        }
    }

    #[test]
    fn a_file_that_is_one_open_fence_still_gets_starts_but_not_exact_ones() {
        let text = format!("```\n{}", "code line\n\n".repeat(1_000_000));
        let index = index_of(text.as_bytes(), 1 << 16);
        assert!(!index.checkpoints().is_empty());
        assert!(index.checkpoints().iter().all(|start| !start.exact));
        for pair in index.checkpoints().windows(2) {
            assert!(pair[1].offset - pair[0].offset <= LONGEST_GAP + 64);
        }
    }

    #[test]
    fn a_file_that_is_one_line_is_cut_where_characters_start() {
        let text = "é".repeat(6 * 1024 * 1024);
        let index = index_of(text.as_bytes(), 1 << 16);
        assert!(!index.checkpoints().is_empty());
        for start in index.checkpoints() {
            assert!(!start.exact);
            assert!(text.is_char_boundary(start.offset as usize));
        }
        assert_eq!(index.lines, 1);
    }

    #[test]
    fn a_start_is_found_by_byte_and_by_line() {
        let text = sections(20_000);
        let index = index_of(text.as_bytes(), 1 << 16);
        let third = index.checkpoints()[2];
        assert_eq!(index.start_at_or_before(third.offset), third);
        assert_eq!(index.start_at_or_before(third.offset + 10), third);
        assert_eq!(index.start_at_or_before(third.offset - 1), index.checkpoints()[1]);
        assert_eq!(index.start_at_or_before(10).offset, 0);
        assert_eq!(index.start_after(third.offset), Some(index.checkpoints()[3]));
        assert_eq!(index.start_at_or_before_line(third.line + 3), third);
    }
}
