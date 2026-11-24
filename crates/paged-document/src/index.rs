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

    /// The last exact start whose whole line is above `offset`: the one
    /// before the last exact start at or before it. An edit at `offset`
    /// changes neither that line nor anything above it.
    pub(crate) fn exact_start_above_the_line_of(&self, offset: u64) -> Checkpoint {
        let after = self.checkpoints.partition_point(|checkpoint| checkpoint.offset <= offset);
        let mut exact = self.checkpoints[..after].iter().rev().filter(|checkpoint| checkpoint.exact);
        exact.nth(1).copied().unwrap_or(START_OF_FILE)
    }

    /// The first start after `offset`, if the index has reached one.
    pub fn start_after(&self, offset: u64) -> Option<Checkpoint> {
        let after = self.checkpoints.partition_point(|checkpoint| checkpoint.offset <= offset);
        self.checkpoints.get(after).copied()
    }

    /// The last start at or before line `line`.
    pub fn start_at_or_before_line(&self, line: u64) -> Checkpoint {
        let after = self.checkpoints.partition_point(|checkpoint| checkpoint.line <= line);
        after.checked_sub(1).map_or(START_OF_FILE, |at| self.checkpoints[at])
    }
}

pub(crate) const START_OF_FILE: Checkpoint = Checkpoint { offset: 0, line: 0, exact: true };

/// A line the builder has read to its end.
pub(crate) struct LineSeen {
    /// The byte the line starts at, and its number from 0.
    pub(crate) offset: u64,
    pub(crate) line: u64,
    /// A top-level block starts at it with nothing open above.
    pub(crate) clean: bool,
}

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

    /// The byte the builder will read next.
    pub(crate) fn position(&self) -> u64 {
        self.line_start + self.line_len
    }

    #[cfg(test)]
    pub(crate) fn feed(&mut self, bytes: &[u8]) {
        self.feed_lines(bytes, &mut |_| false);
    }

    /// Reads `bytes`, telling `seen` of each line as it ends. When `seen`
    /// answers true the builder stops there. Returns the bytes it read.
    pub(crate) fn feed_lines(&mut self, bytes: &[u8], seen: &mut dyn FnMut(LineSeen) -> bool) -> usize {
        let mut read = 0;
        while read < bytes.len() {
            let Some(end) = memchr::memchr(b'\n', &bytes[read..]) else {
                self.line_text(&bytes[read..]);
                return bytes.len();
            };
            self.line_text(&bytes[read..read + end]);
            read += end + 1;
            let line = self.end_line();
            if seen(line) {
                break;
            }
        }
        read
    }

    /// The text has ended; a last line without a line break is a line.
    pub(crate) fn end_text(&mut self) {
        if self.line_len > 0 {
            self.end_line_at(self.line_start + self.line_len);
        }
        self.index.complete = true;
    }

    /// The index of a file read to its end.
    #[cfg(test)]
    pub(crate) fn finish(mut self) -> Index {
        self.end_text();
        self.index
    }

    /// Forgets the starts after `start` and reads on from it, as from the
    /// top of a file: a clean start has nothing open above it. Returns the
    /// starts it forgot.
    pub(crate) fn restart_at(&mut self, start: Checkpoint) -> Vec<Checkpoint> {
        let kept = self.index.checkpoints.partition_point(|checkpoint| checkpoint.offset <= start.offset);
        let forgotten = self.index.checkpoints.split_off(kept);
        self.scanner = LineScanner::default();
        self.prefix.clear();
        self.line_start = start.offset;
        self.line_len = 0;
        self.last_start = start.offset;
        self.index.lines = start.line;
        self.index.indexed_bytes = start.offset;
        self.index.complete = false;
        forgotten
    }

    /// Adds a start found before, when it is beyond the last one.
    pub(crate) fn add_start(&mut self, start: Checkpoint) {
        if start.offset > 0 && self.index.checkpoints.last().is_none_or(|last| last.offset < start.offset) {
            self.index.checkpoints.push(start);
        }
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

    fn end_line(&mut self) -> LineSeen {
        self.end_line_at(self.line_start + self.line_len + 1)
    }

    fn end_line_at(&mut self, next_line: u64) -> LineSeen {
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
        let seen = LineSeen { offset: self.line_start, line: self.index.lines, clean };
        self.index.lines += 1;
        self.index.indexed_bytes = next_line;
        self.line_start = next_line;
        self.line_len = 0;
        self.prefix.clear();
        seen
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
