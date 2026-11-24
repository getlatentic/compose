//! Edits to a file on disk: the index reads again only near an edit, and a
//! save puts the text in the file's place.

use std::io::Write;
use std::time::{Duration, Instant};

use paged_document::{PagedDocument, SaveError};

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

fn time_to_index(document: &PagedDocument) -> Duration {
    let started = Instant::now();
    document.wait_until_indexed();
    started.elapsed()
}

#[test]
fn an_edit_at_the_top_reads_little_of_the_file_again() {
    let mut text = sections(300_000);
    let file = on_disk(&text);
    let document = PagedDocument::open(file.path()).expect("open");
    let whole = time_to_index(&document);
    let lines = document.progress().lines;
    for (at, added) in [(1000, "typed"), (text.len() / 2, "\n\n## A new section\n\nWith text.\n\n"), (text.len(), "\nthe end\n")] {
        let at = (0..=at).rev().find(|at| text.is_char_boundary(*at)).expect("a place");
        document.edit(at as u64, at as u64, added).expect("edit");
        text.insert_str(at, added);
        let again = time_to_index(&document);
        assert!(again < whole / 20 + Duration::from_millis(5), "indexed in {whole:?}, and again in {again:?} after an edit at {at}");
    }
    let progress = document.progress();
    assert_eq!(progress.total_bytes, text.len() as u64);
    assert_eq!(progress.lines, lines + 8);
    let end = document.window(document.size(), WINDOW).expect("end");
    assert!(end.exact);
    assert_eq!(end.text, &text[end.from as usize..]);
    assert_eq!(end.first_line, Some(text[..end.from as usize].matches('\n').count() as u64));
}

#[test]
fn an_edit_below_where_the_index_has_read_shows_in_windows_at_once() {
    let mut text = sections(300_000);
    let file = on_disk(&text);
    let document = PagedDocument::open(file.path()).expect("open");
    let at = text.len() - 40;
    document.edit(at as u64, at as u64 + 4, "edited").expect("edit");
    text.replace_range(at..at + 4, "edited");
    let end = document.window(document.size(), WINDOW).expect("end");
    assert_eq!(end.text, &text[end.from as usize..]);
    document.wait_until_indexed();
    let end = document.window(document.size(), WINDOW).expect("end");
    assert!(end.exact);
    assert_eq!(end.text, &text[end.from as usize..]);
}

#[test]
fn an_edit_inside_a_character_is_refused() {
    let file = on_disk("éé\n");
    let document = PagedDocument::open(file.path()).expect("open");
    assert!(document.edit(1, 1, "x").is_err());
    assert!(document.edit(0, 3, "x").is_err());
    assert!(document.edit(2, 6, "x").is_err());
    assert!(!document.is_edited());
    assert_eq!(document.edit(0, 2, "e").expect("edit"), 4);
    assert!(document.is_edited());
}

#[test]
fn a_save_puts_the_text_in_the_file_and_edits_go_on() {
    let mut text = sections(5_000);
    let file = on_disk(&text);
    let document = PagedDocument::open(file.path()).expect("open");
    for round in 0..3 {
        let at = text.len() / 3 * round;
        let at = (0..=at).rev().find(|at| text.is_char_boundary(*at)).expect("a place");
        let added = format!("round {round}\n\n");
        document.edit(at as u64, at as u64, &added).expect("edit");
        text.insert_str(at, &added);
        assert!(document.is_edited());
        let saved = document.save().expect("save");
        assert_eq!(saved.size, text.len() as u64);
        assert!(!document.is_edited());
        assert_eq!(std::fs::read_to_string(file.path()).expect("read"), text);
    }
    let left: Vec<_> = std::fs::read_dir(file.path().parent().expect("folder")).expect("folder").flatten().filter(|entry| entry.file_name().to_string_lossy().ends_with(".compose-saving")).collect();
    assert!(left.is_empty(), "{left:?}");
}

/// Puts a file with `text` in the place of the one at `path`, as an editor
/// that saves by renaming does.
fn replace(path: &std::path::Path, text: &str) {
    let beside = path.with_extension("theirs");
    std::fs::write(&beside, text).expect("write");
    std::fs::rename(&beside, path).expect("rename");
}

#[test]
fn a_save_does_not_write_over_a_file_another_put_in_its_place() {
    let file = on_disk(&sections(100));
    let document = PagedDocument::open(file.path()).expect("open");
    document.edit(0, 0, "mine\n\n").expect("edit");
    std::thread::sleep(Duration::from_millis(20));
    assert!(!document.changed_on_disk());
    replace(file.path(), "theirs\n");
    assert!(document.changed_on_disk());
    assert!(matches!(document.save(), Err(SaveError::ChangedOnDisk)));
    assert_eq!(std::fs::read_to_string(file.path()).expect("read"), "theirs\n");
    assert!(document.is_edited());
    document.save_over_changes().expect("save");
    assert!(std::fs::read_to_string(file.path()).expect("read").starts_with("mine\n\n## Section 0"));
    assert!(!document.is_edited());
    assert!(!document.changed_on_disk());
    document.edit(0, 0, "more\n\n").expect("edit");
    document.save().expect("save");
}

#[test]
fn a_file_written_into_by_another_is_not_saved_over() {
    let file = on_disk(&sections(100));
    let document = PagedDocument::open(file.path()).expect("open");
    document.edit(0, 0, "mine\n\n").expect("edit");
    std::thread::sleep(Duration::from_millis(20));
    std::fs::write(file.path(), "theirs\n").expect("write");
    assert!(matches!(document.save(), Err(SaveError::ChangedOnDisk)));
    assert!(matches!(document.save_over_changes(), Err(SaveError::TextLost)));
    assert_eq!(std::fs::read_to_string(file.path()).expect("read"), "theirs\n");
}

/// Set `PAGED_BIG_GB` to run, as for the windows of a huge file: an edit,
/// the index after it, and a save are timed.
#[test]
fn a_huge_file_takes_an_edit_at_once_and_saves() {
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
    let document = PagedDocument::open(file.path()).expect("open");
    let size = document.size();
    let early = Instant::now();
    document.edit(size / 2, size / 2, "typed before the index got here").expect("edit");
    let window = document.window(size / 2, WINDOW).expect("window");
    let early = early.elapsed();
    assert!(window.text.contains("typed before the index got here"));
    let whole = time_to_index(&document);
    let mut slowest_edit = Duration::ZERO;
    let mut slowest_index = Duration::ZERO;
    for (number, at) in [10, size / 3, size - 10].into_iter().enumerate() {
        for key in 0..200 {
            let started = Instant::now();
            document.edit(at + key, at + key, "x").expect("edit");
            document.window(at, WINDOW).expect("window");
            slowest_edit = slowest_edit.max(started.elapsed());
        }
        slowest_index = slowest_index.max(time_to_index(&document));
        assert!(document.window(at, WINDOW).expect("window").exact, "place {number}");
    }
    let started = Instant::now();
    let saved = document.save().expect("save");
    let save = started.elapsed();
    println!("{gigabytes} GB: edit and window before the index {early:?}; indexed in {whole:?}; slowest key and window {slowest_edit:?}; slowest index after 200 keys {slowest_index:?}; saved in {save:?}");
    assert_eq!(saved.size, size + 31 + 600);
    assert!(early.as_millis() < 100 && slowest_edit.as_millis() < 100, "{early:?} {slowest_edit:?}");
    assert!(slowest_index.as_millis() < 500, "{slowest_index:?}");
}
