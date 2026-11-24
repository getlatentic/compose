//! Reads a markdown file line by line and says where a top-level block
//! starts with nothing open above it.
//!
//! Markdown is read downward. What a line means depends on what stands open
//! above it: a code fence, an HTML block, a `$$` block, a list item. Where
//! none of those is open and a block starts after an empty line, a parser
//! that starts reading there reads the rest exactly as it would after
//! reading the whole file. Those places are where a window of the file may
//! start.
//!
//! The scanner errs one way only. It may miss a place that would do, and so
//! make a window longer than it had to be. It must not name a place where
//! something is still open.

/// A code fence that is open: the character it was opened with, and how many.
#[derive(Clone, Copy, PartialEq, Eq)]
struct Fence {
    mark: u8,
    len: usize,
}

/// How much of a line is looked at. A longer line is read by its start.
pub(crate) const LINE_PREFIX: usize = 4096;

/// More readings than this of what stands open, and the scanner stops
/// naming clean starts: it no longer knows.
const MOST_READINGS: usize = 32;

/// One reading of what stands open above the next line.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Open {
    fence: Option<Fence>,
    /// The text that ends the HTML block that is open.
    html_until: Option<&'static [u8]>,
    /// An HTML block that the next empty line ends.
    html_until_empty: bool,
    math: bool,
    /// The indent the text of the open list item stands at.
    list_indent: Option<usize>,
    after_empty: bool,
}

/// The scanner. Where a line can be read two ways, it follows both: a start
/// is clean only when every reading agrees that nothing is open.
pub(crate) struct LineScanner {
    readings: Vec<Open>,
    /// The readings after the line being read, and the ways one reading
    /// reads it: kept, so that a line costs no allocation.
    next: Vec<Open>,
    ways: Vec<(bool, Open)>,
    /// There were too many readings to follow.
    lost: bool,
}

impl Default for LineScanner {
    fn default() -> Self {
        // The start of a file is like the line after an empty one.
        Self { readings: vec![Open { after_empty: true, ..Open::default() }], next: Vec::new(), ways: Vec::new(), lost: false }
    }
}

/// A line as the scanner sees it: its indent, its text after the indent,
/// and what that text can open. Read once, whatever the number of readings.
struct Line<'a> {
    indent: usize,
    text: &'a [u8],
    empty: bool,
    /// The width of the list marker the text starts with.
    marker: Option<usize>,
    rule: bool,
    fence: Option<Fence>,
    /// The text starts with `<`, and what ends the HTML block it opens when
    /// that is one an empty line does not end.
    html: bool,
    html_end: Option<&'static [u8]>,
    math_mark: bool,
}

impl<'a> Line<'a> {
    /// `prefix` is the start of the line, without its line break; `whole`
    /// says that it is all of the line.
    fn read(prefix: &'a [u8], whole: bool) -> Self {
        let prefix = prefix.strip_suffix(b"\r").unwrap_or(prefix);
        let spaces = prefix.iter().take_while(|byte| **byte == b' ').count();
        let text = &prefix[spaces..];
        // A tab in the indent is at least a code block's indent; counted so,
        // no block is taken to start there.
        let indent = if text.first() == Some(&b'\t') { spaces + 4 } else { spaces };
        let mut line = Self { indent, text, empty: false, marker: None, rule: false, fence: None, html: false, html_end: None, math_mark: false };
        // Most lines start with a letter and open nothing.
        match text.first() {
            None | Some(b' ' | b'\t') => line.empty = whole && text.iter().all(u8::is_ascii_whitespace),
            Some(b'-' | b'*' | b'_' | b'+' | b'0'..=b'9') => {
                line.rule = is_rule(text);
                line.marker = if line.rule { None } else { list_marker(text) };
            }
            Some(b'`' | b'~') => line.fence = fence_opener(text),
            Some(b'<') => {
                line.html = true;
                line.html_end = html_end(text);
            }
            Some(b'$') => line.math_mark = is_math_mark(text),
            Some(_) => {}
        }
        line
    }
}

impl LineScanner {
    /// Takes the next line, and says whether a top-level block starts at it
    /// with nothing open above.
    pub(crate) fn line(&mut self, prefix: &[u8], whole: bool) -> bool {
        let line = Line::read(prefix, whole);
        let mut clean = !self.lost;
        self.next.clear();
        for reading in &self.readings {
            self.ways.clear();
            reading.line(&line, &mut self.ways);
            for (starts_clean, after) in &self.ways {
                clean &= starts_clean;
                if !self.next.contains(after) {
                    self.next.push(*after);
                }
            }
        }
        self.lost |= self.next.len() > MOST_READINGS;
        self.next.truncate(MOST_READINGS);
        std::mem::swap(&mut self.readings, &mut self.next);
        clean
    }
}

impl Open {
    /// Adds to `ways` each way `line` can be read: whether a top-level
    /// block starts clean at it, and what is open after it.
    fn line(self, line: &Line, ways: &mut Vec<(bool, Open)>) {
        let in_fence = self.fence.is_some();
        let in_math = self.math;
        let first = ways.len();
        self.blocks(line, ways);
        // The editor pairs lone `$$` lines into blocks of math wherever they
        // are not code. To the parser they are text, so what they stand in
        // (a list, an HTML block) goes on being read as it is.
        if !line.math_mark || in_fence {
            for (clean, _) in &mut ways[first..] {
                *clean &= !in_math;
            }
            return;
        }
        for at in first..ways.len() {
            let open = ways[at].1;
            ways[at] = (false, Open { math: !open.math, ..open });
            // Indented this far the line may be code, where `$$` pairs nothing.
            if line.indent >= 4 {
                ways.push((false, open));
            }
        }
    }

    /// The readings of the blocks `line` is in, opens or closes.
    fn blocks(mut self, line: &Line, ways: &mut Vec<(bool, Open)>) {
        let after_empty = std::mem::replace(&mut self.after_empty, line.empty);
        if self.inside_open_block(line) || line.empty {
            ways.push((false, self));
            return;
        }
        let (kept, ended) = self.out_of_the_list(line, after_empty);
        for mut reading in std::iter::once(kept).chain(ended) {
            // A line that starts with `<` and opens none of the long HTML
            // blocks is an HTML block up to the next empty line, or it is
            // text. Which, depends on more of HTML than is read here.
            if line.indent < 4 && line.html && line.html_end.is_none() {
                ways.push((false, Open { html_until_empty: true, ..reading }));
            }
            // Right under a line of text, a marker starts an item or is more
            // of that text: a number other than 1 never cuts into a paragraph.
            if !after_empty && line.indent < 4 && line.marker.is_some() {
                ways.push((false, reading));
            }
            let inside_item = reading.list_indent.is_some_and(|text_indent| line.indent >= text_indent);
            let clean = !inside_item && reading.open_block(line, after_empty);
            ways.push((clean, reading));
        }
    }

    /// The readings of whether the open list goes on at `line`: one, or two
    /// where it cannot be told. A line at the indent of the item's text is
    /// in the item. Left of it, an empty line above, a fence, an HTML block
    /// or a rule ends the list, and another item carries it on. Text there
    /// is a further line of the item's paragraph, or a paragraph of its own:
    /// that depends on what the item ends with, so both are followed.
    fn out_of_the_list(self, line: &Line, after_empty: bool) -> (Open, Option<Open>) {
        let Some(text_indent) = self.list_indent else { return (self, None) };
        if line.indent >= text_indent || line.marker.is_some() {
            return (self, None);
        }
        let ended = Open { list_indent: None, ..self };
        let ends_it = after_empty || (line.indent < 4 && (line.fence.is_some() || line.html_end.is_some() || line.rule));
        if ends_it { (ended, None) } else { (self, Some(ended)) }
    }

    /// The line is inside a fence or an HTML block, or closes it.
    fn inside_open_block(&mut self, line: &Line) -> bool {
        if let Some(fence) = &self.fence {
            if line.indent < 4 && closes_fence(line.text, fence) {
                self.fence = None;
            }
            return true;
        }
        if let Some(end) = self.html_until {
            if contains_ignoring_case(line.text, end) {
                self.html_until = None;
            }
            return true;
        }
        if self.html_until_empty {
            self.html_until_empty = !line.empty;
            return true;
        }
        false
    }

    /// Opens what the line opens, and says whether it is a clean start.
    fn open_block(&mut self, line: &Line, after_empty: bool) -> bool {
        if line.indent >= 4 {
            return false;
        }
        if let Some(fence) = line.fence {
            self.fence = Some(fence);
            return after_empty && line.indent == 0 && self.list_indent.is_none();
        }
        if let Some(marker) = line.marker {
            self.list_indent = Some(line.indent + marker + 1);
            return false;
        }
        if line.html {
            self.html_until = line.html_end.filter(|end| !contains_ignoring_case(line.text, end));
            return false;
        }
        after_empty && line.indent == 0 && self.list_indent.is_none() && line.text.first() != Some(&b'>')
    }
}

fn run_of(text: &[u8], mark: u8) -> usize {
    text.iter().take_while(|byte| **byte == mark).count()
}

fn fence_opener(text: &[u8]) -> Option<Fence> {
    let mark = *text.first()?;
    if mark != b'`' && mark != b'~' {
        return None;
    }
    let len = run_of(text, mark);
    // The text after a backtick fence names its language and holds no backtick.
    let named_with_mark = mark == b'`' && text[len..].contains(&b'`');
    (len >= 3 && !named_with_mark).then_some(Fence { mark, len })
}

fn closes_fence(text: &[u8], fence: &Fence) -> bool {
    let len = run_of(text, fence.mark);
    len >= fence.len && text[len..].iter().all(u8::is_ascii_whitespace)
}

/// A lone `$$`: the editor opens and closes a block of math with it.
fn is_math_mark(text: &[u8]) -> bool {
    text.trim_ascii_end() == b"$$"
}

/// A rule across the page: three or more of `-`, `*` or `_`, and spaces.
fn is_rule(text: &[u8]) -> bool {
    let marks = || text.iter().filter(|byte| !matches!(byte, b' ' | b'\t'));
    let Some(mark) = marks().next() else { return false };
    matches!(mark, b'-' | b'*' | b'_') && marks().count() >= 3 && marks().all(|byte| byte == mark)
}

/// The width of the list marker `text` starts with: `-`, `+`, `*`, or a
/// number and `.` or `)`, each before a space or the end of the line. A
/// rule (`* * *`) starts with one and is no list: the caller rules it out.
fn list_marker(text: &[u8]) -> Option<usize> {
    let digits = text.iter().take_while(|byte| byte.is_ascii_digit()).count();
    let width = match text.get(digits)? {
        b'-' | b'+' | b'*' if digits == 0 => 1,
        b'.' | b')' if (1..=9).contains(&digits) => digits + 1,
        _ => return None,
    };
    matches!(text.get(width), None | Some(b' ') | Some(b'\t')).then_some(width)
}

/// The text that ends the HTML block `text` opens, for the kinds of block
/// an empty line does not end.
fn html_end(text: &[u8]) -> Option<&'static [u8]> {
    const BLOCKS: [(&[u8], &[u8]); 7] = [
        (b"<!--", b"-->"),
        (b"<?", b"?>"),
        (b"<![cdata[", b"]]>"),
        (b"<script", b"</script>"),
        (b"<pre", b"</pre>"),
        (b"<style", b"</style>"),
        (b"<textarea", b"</textarea>"),
    ];
    BLOCKS.iter().find(|(start, _)| starts_ignoring_case(text, start)).map(|(_, end)| *end)
}

fn starts_ignoring_case(text: &[u8], start: &[u8]) -> bool {
    text.len() >= start.len() && text[..start.len()].eq_ignore_ascii_case(start)
}

fn contains_ignoring_case(text: &[u8], needle: &[u8]) -> bool {
    text.windows(needle.len()).any(|window| window.eq_ignore_ascii_case(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The numbers of the lines (from 0) a block starts clean at, below the
    /// first: the start of a file is always one.
    fn clean_starts(text: &str) -> Vec<usize> {
        let mut scanner = LineScanner::default();
        text.split('\n').enumerate().filter(|(number, line)| scanner.line(line.as_bytes(), true) && *number > 0).map(|(number, _)| number).collect()
    }

    #[test]
    fn the_start_of_a_file_is_a_clean_start() {
        assert!(LineScanner::default().line(b"text", true));
    }

    #[test]
    fn a_block_after_an_empty_line_starts_clean() {
        assert_eq!(clean_starts("# Title\n\ntext\nmore\n\n## Next"), [2, 5]);
    }

    #[test]
    fn nothing_starts_inside_a_fence_and_the_fence_closes_by_its_own_mark() {
        assert_eq!(clean_starts("```\n\ntext\n\n~~~\n\nstill code\n\n```\n\nafter"), [10]);
        assert_eq!(clean_starts("````\n\n```\n\ncode\n\n````\n\nafter"), [8]);
    }

    #[test]
    fn a_fence_after_an_empty_line_is_itself_a_clean_start() {
        assert_eq!(clean_starts("text\n\n```js\ncode\n```\n\nafter"), [2, 6]);
    }

    #[test]
    fn nothing_starts_inside_a_list_and_text_at_the_margin_ends_it() {
        assert_eq!(clean_starts("- one\n\n  more\n\n- two\n\ntext"), [6]);
        assert_eq!(clean_starts("1. one\n\n   ```\n   code\n\ntext"), [5]);
    }

    #[test]
    fn a_fence_that_cuts_into_a_list_item_is_open_at_the_top_level() {
        assert_eq!(clean_starts("- one\n```\n\ntext\n\n```\n\nafter"), [7]);
    }

    #[test]
    fn nothing_starts_inside_math_a_comment_or_a_quote() {
        assert_eq!(clean_starts("$$\n\nx\n\n$$\n\nafter"), [6]);
        assert_eq!(clean_starts("<!--\n\ntext\n\n-->\n\nafter"), [6]);
        assert_eq!(clean_starts("text\n\n> quote\n\nafter"), [4]);
    }

    #[test]
    fn an_indented_line_starts_nothing_clean() {
        assert_eq!(clean_starts("text\n\n    code\n\n  text"), Vec::<usize>::new());
    }

    /// The top-level blocks of `text` as a markdown parser reads them: the
    /// kind of each and the lines it covers, counted from `first_line`.
    fn blocks(text: &str, first_line: usize) -> Vec<String> {
        let mut options = comrak::Options::default();
        options.extension.table = true;
        options.extension.strikethrough = true;
        options.extension.tasklist = true;
        options.extension.autolink = true;
        let arena = comrak::Arena::new();
        comrak::parse_document(&arena, text, &options)
            .children()
            .map(|node| {
                let data = node.data.borrow();
                let kind = format!("{:?}", data.value);
                let kind = kind.split(['(', ' ', '{']).next().unwrap_or_default().to_owned();
                format!("{kind} {}-{}", data.sourcepos.start.line + first_line, data.sourcepos.end.line + first_line)
            })
            .collect()
    }

    const LINES: [&str; 34] = [
        "", "", "", "text", "more text", "- item", "  continued", "   - nested", "1. one", "> quote", "```", "```js", "~~~", "````", "  ```", "    code",
        "$$", "<!--", "-->", "<pre>", "</pre>", "<div>", "</div>", "| a | b |", "| - | - |", "# heading", "---", "* * *", "[a]: http://x", "\t tab",
        "text `code` $x$", "+ plus", "2) two", ">",
    ];

    /// A seeded generator (xorshift), so a failure repeats.
    fn random_document(seed: u64, lines: usize) -> String {
        let mut state = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
        let mut text = String::new();
        for _ in 0..lines {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            text.push_str(LINES[(state % LINES.len() as u64) as usize]);
            text.push('\n');
        }
        text
    }

    /// The property the index rests on: from a clean start, a parser reads
    /// the rest of the file as it does after reading all of it.
    #[test]
    fn a_parser_reads_the_same_blocks_from_a_clean_start_as_from_the_top() {
        let mut starts_checked = 0;
        for seed in 1..=20_000 {
            let text = random_document(seed, 40);
            let whole = blocks(&text, 0);
            let mut offset = 0;
            let mut scanner = LineScanner::default();
            for (number, line) in text.split('\n').enumerate() {
                if scanner.line(line.as_bytes(), true) {
                    let below: Vec<&String> = whole.iter().filter(|block| block.rsplit(' ').next().and_then(|span| span.split('-').next()).and_then(|line| line.parse::<usize>().ok()).is_some_and(|line| line > number)).collect();
                    let from_here = blocks(&text[offset..], number);
                    assert_eq!(from_here.iter().collect::<Vec<_>>(), below, "seed {seed}, line {number}:\n{text}");
                    starts_checked += 1;
                }
                offset += line.len() + 1;
            }
        }
        assert!(starts_checked > 10_000, "only {starts_checked} clean starts were checked");
    }
}
