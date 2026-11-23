//! Windows of a file on disk: they tile it exactly, start where the index
//! says, and are there before the index is.

use std::io::Write;
use std::time::Instant;

use paged_document::PagedDocument;

const WINDOW: usize = 256 * 1024;

fn sections(count: usize) -> String {
    (0..count).map(|n| format!("## Section {n} é\n\nA paragraph of text for section {n}, long enough to add up.\n\n- item\n- item\n\n```\ncode {n}\n\nmore\n```\n\n")).collect()
}

fn on_disk(text: &str) -> tempfile::NamedTempFile {
    let mut file = tempfile::NamedTempFile::new().expect("temp file");
    file.write_all(text.as_bytes()).expect("write");
    file.flush().expect("flush");
    file
}

#[test]
fn windows_laid_end_to_end_are_the_file() {
    let text = sections(40_000);
    let file = on_disk(&text);
    let document = PagedDocument::open(file.path()).expect("open");
    document.wait_until_indexed();
    let mut read = String::new();
    let mut at = 0;
    while at < document.size() {
        let window = document.window(at, WINDOW).expect("window");
        assert_eq!(window.from, at);
        assert!(window.exact, "window at {at}");
        assert!(window.text.len() <= WINDOW + 128 * 1024, "window of {} bytes", window.text.len());
        assert_eq!(window.first_line, Some(text[..at as usize].matches('\n').count() as u64));
        read.push_str(&window.text);
        at = window.to;
    }
    assert_eq!(read, text);
}

#[test]
fn a_window_holds_the_place_asked_for_and_starts_a_block() {
    let text = sections(40_000);
    let file = on_disk(&text);
    let document = PagedDocument::open(file.path()).expect("open");
    document.wait_until_indexed();
    for around in [0, 1, text.len() as u64 / 3, text.len() as u64 / 2 + 17, text.len() as u64 - 1, text.len() as u64] {
        let window = document.window(around, WINDOW).expect("window");
        assert!(window.from <= around && around <= window.to, "{around} in {}..{}", window.from, window.to);
        assert_eq!(window.text, &text[window.from as usize..window.to as usize]);
        assert!(window.from == 0 || text.as_bytes()[window.from as usize - 2..window.from as usize] == *b"\n\n");
    }
}

#[test]
fn a_window_is_found_by_line() {
    let text = sections(40_000);
    let file = on_disk(&text);
    let document = PagedDocument::open(file.path()).expect("open");
    document.wait_until_indexed();
    let line = 300_000;
    let window = document.window_at_line(line, WINDOW).expect("window");
    let first = window.first_line.expect("line");
    let lines = window.text.matches('\n').count() as u64;
    assert!(first <= line && line < first + lines, "line {line} in {first}..{}", first + lines);
}

#[test]
fn progress_ends_at_the_whole_file() {
    let text = sections(1_000);
    let file = on_disk(&text);
    let document = PagedDocument::open(file.path()).expect("open");
    document.wait_until_indexed();
    let progress = document.progress();
    assert!(progress.complete);
    assert_eq!(progress.indexed_bytes, text.len() as u64);
    assert_eq!(progress.total_bytes, text.len() as u64);
    assert_eq!(progress.lines as usize, text.matches('\n').count());
}

/// Set `PAGED_BIG_GB` to run: writes a file of that many gigabytes beside
/// the test's temporary files and removes it. The first window, and a jump
/// to the middle and to the end, must each take well under a frame's worth
/// of patience, whether or not the index has got there.
#[test]
fn a_huge_file_opens_at_once_and_jumps_anywhere() {
    let Some(gigabytes) = std::env::var("PAGED_BIG_GB").ok().and_then(|value| value.parse::<f64>().ok()) else { return };
    let section = sections(1);
    let target = (gigabytes * 1024.0 * 1024.0 * 1024.0) as u64;
    let mut file = tempfile::NamedTempFile::new().expect("temp file");
    {
        let mut out = std::io::BufWriter::with_capacity(8 << 20, file.as_file_mut());
        let mut written = 0;
        while written < target {
            out.write_all(section.as_bytes()).expect("write");
            written += section.len() as u64;
        }
        out.flush().expect("flush");
    }
    let opened = Instant::now();
    let document = PagedDocument::open(file.path()).expect("open");
    let first = document.window(0, WINDOW).expect("first window");
    let to_first = opened.elapsed();
    assert!(first.exact);
    let jumped = Instant::now();
    let middle = document.window(document.size() / 2, WINDOW).expect("middle");
    let end = document.window(document.size(), WINDOW).expect("end");
    let early_jumps = jumped.elapsed();
    let indexed_at_jump = document.progress().indexed_bytes;
    document.wait_until_indexed();
    let indexed = opened.elapsed();
    let jumped = Instant::now();
    let exact_middle = document.window(document.size() / 2, WINDOW).expect("middle");
    let exact_end = document.window(document.size(), WINDOW).expect("end");
    let late_jumps = jumped.elapsed();
    println!(
        "{gigabytes} GB: first window {to_first:?}; two jumps before the index reached them {early_jumps:?} (index at {:.1}%); indexed in {indexed:?}; two jumps after {late_jumps:?}; {} lines",
        indexed_at_jump as f64 * 100.0 / document.size() as f64,
        document.progress().lines
    );
    assert!(!middle.text.is_empty() && !end.text.is_empty());
    assert!(exact_middle.exact && exact_end.exact);
    for window in [&first, &middle, &end, &exact_middle, &exact_end] {
        assert!(window.text.len() <= WINDOW + 128 * 1024, "window of {} bytes", window.text.len());
    }
    assert!(to_first.as_millis() < 100, "first window took {to_first:?}");
    assert!(early_jumps.as_millis() < 100 && late_jumps.as_millis() < 100, "jumps took {early_jumps:?} and {late_jumps:?}");
}
