//! A document under random edits against a `String` that takes the same
//! edits: the text, the windows, the saved file, and every start the index
//! names are checked against it.

use std::collections::HashSet;
use std::io::Write;

use crate::index::{LONGEST_GAP, SPACING};
use crate::scan::{LineScanner, LINE_PREFIX};
use crate::PagedDocument;

struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn below(&mut self, limit: usize) -> usize {
        (self.next() % limit.max(1) as u64) as usize
    }
}

/// Text that opens, closes and leaves open what the scanner follows.
const FRAGMENTS: &[&str] = &[
    "\n",
    "\n\n",
    "## Heading é\n\n",
    "A paragraph of plain text, long enough to add up over many lines of it.\n",
    "A paragraph of plain text, long enough to add up over many lines of it.\n\n",
    "- item\n- item\n",
    "  more of the item\n",
    "1. one\n2. two\n\n",
    "```\ncode\n\nmore\n```\n\n",
    "```\n",
    "~~~~\n",
    "$$\n",
    "$$\nx^2\n$$\n\n",
    "<div>\n",
    "</div>\n\n",
    "<!-- a comment\n",
    "-->\n\n",
    "> quote\n",
    "    indented\n",
    "* * *\n\n",
    "| a | b |\n| - | - |\n| 1 | 2 |\n\n",
    "word ",
    "é",
    "#",
    " ",
];

/// Text where each block is closed, so clean starts are many and the index
/// meets its earlier starts below an edit.
const TIDY: &[&str] = &[
    "## Heading é\n\n",
    "A paragraph of plain text, long enough to add up over many lines of it.\n\n",
    "- item\n- item\n\n",
    "```\ncode\n\nmore\n```\n\n",
    "$$\nx^2\n$$\n\n",
    "| a | b |\n| - | - |\n| 1 | 2 |\n\n",
    "word ",
    "é",
    "\n\n",
    "```\n",
];

fn some_text(random: &mut Random, from: &[&str], fragments: usize) -> String {
    (0..fragments).map(|_| from[random.below(from.len())]).collect()
}

/// A place in `text` near `at` that is not inside a character.
fn char_start(text: &str, mut at: usize) -> usize {
    while !text.is_char_boundary(at) {
        at -= 1;
    }
    at
}

/// The starts of the lines of `text` where a reading of the whole text
/// finds a top-level block with nothing open above.
fn clean_starts(text: &str) -> HashSet<u64> {
    let mut scanner = LineScanner::default();
    let mut clean = HashSet::new();
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        let body = line.strip_suffix('\n').unwrap_or(line).as_bytes();
        let prefix = &body[..body.len().min(LINE_PREFIX)];
        if scanner.line(prefix, prefix.len() == body.len()) {
            clean.insert(offset as u64);
        }
        offset += line.len();
    }
    clean
}

fn check_against(document: &PagedDocument, text: &str, step: usize) {
    document.wait_until_indexed();
    assert_eq!(document.size(), text.len() as u64, "step {step}");
    let index = document.index();
    assert_eq!(index.indexed_bytes, text.len() as u64, "step {step}");
    assert_eq!(index.lines as usize, text.split_inclusive('\n').count(), "step {step}");
    let clean = clean_starts(text);
    let mut last = 0;
    let mut lines = 0;
    for start in index.checkpoints() {
        lines += text[last as usize..start.offset as usize].matches('\n').count();
        assert!(start.offset > last, "step {step}: starts {last} then {}", start.offset);
        assert!(start.offset - last < LONGEST_GAP + SPACING, "step {step}: no start from {last} to {}", start.offset);
        assert_eq!(start.line as usize, lines, "step {step}: line of the start at {}", start.offset);
        if start.exact {
            assert!(clean.contains(&start.offset), "step {step}: the start at {} is not clean", start.offset);
        }
        last = start.offset;
    }
    let mut read = String::new();
    let mut at = 0;
    while at < document.size() {
        let window = document.window(at, 48 * 1024).expect("window");
        assert_eq!(window.from, at, "step {step}");
        assert!(window.to > at, "step {step}: an empty window at {at}");
        read.push_str(&window.text);
        at = window.to;
    }
    assert!(read == text, "step {step}: the windows are not the text");
}

fn edit_at_random(document: &PagedDocument, text: &mut String, random: &mut Random, fragments: &[&str]) {
    let from = char_start(text, random.below(text.len() + 1));
    let longest = [0, 0, 0, 1, 1, 8, 8, 200, 200, 100_000][random.below(10)];
    let removed = random.below(longest + 1);
    let to = char_start(text, (from + removed).min(text.len())).max(from);
    let count = [0, 1, 1, 1, 2, 2, 6, 6, 40, 3000][random.below(10)];
    let added = some_text(random, fragments, count);
    let size = document.edit(from as u64, to as u64, &added).expect("edit");
    text.replace_range(from..to, &added);
    assert_eq!(size, text.len() as u64);
}

fn run(seed: u64, from: &[&str], fragments: usize, edits: usize) {
    let mut random = Random(seed);
    let mut text = some_text(&mut random, from, fragments);
    let mut file = tempfile::NamedTempFile::new().expect("temp file");
    file.write_all(text.as_bytes()).expect("write");
    file.flush().expect("flush");
    let document = PagedDocument::open(file.path()).expect("open");
    for step in 0..edits {
        edit_at_random(&document, &mut text, &mut random, from);
        // Most edits come while the index is still reading for the last.
        match random.below(12) {
            0 => check_against(&document, &text, step),
            1 => {
                let around = random.below(text.len() + 1) as u64;
                let window = document.window(around, 32 * 1024).expect("window");
                assert!(window.from <= around && around <= window.to, "step {step}");
                assert!(window.text == text[window.from as usize..window.to as usize], "step {step}: window at {around}");
            }
            2 => {
                document.save().expect("save");
                assert!(std::fs::read_to_string(file.path()).expect("read") == text, "step {step}: the saved file");
            }
            _ => {}
        }
    }
    check_against(&document, &text, edits);
    document.save().expect("save");
    assert!(std::fs::read_to_string(file.path()).expect("read") == text, "the saved file");
    assert!(!document.is_edited());
    check_against(&document, &text, edits + 1);
}

#[test]
fn a_small_document_keeps_its_text_and_its_starts_under_edits() {
    for seed in 1..=10 {
        run(seed, FRAGMENTS, 400, 200);
        run(seed + 50, TIDY, 400, 200);
    }
}

#[test]
fn a_document_of_many_windows_keeps_its_text_and_its_starts_under_edits() {
    for seed in 100..=101 {
        run(seed, FRAGMENTS, 60_000, 200);
        run(seed + 50, TIDY, 60_000, 200);
    }
}
