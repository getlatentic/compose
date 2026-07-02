//! Report-only search baseline for the #70 budget (1k-note query ≤ 100ms).
//!
//! Builds a 1,000-document snapshot with a realistic shape — titles, headings,
//! prose, wikilinks, one needle document — then times `search_snapshot` for the
//! query profiles the search popover actually issues: a common word (large
//! candidate set), a rare word (selective), and a two-token phrase. Asserts a
//! generous ceiling so CI noise can't flake it; the printed medians are what
//! PERF.md cites.

use std::time::Instant;
use workspace_index::{build_snapshot, search_snapshot, IndexedDocument};

fn corpus(documents: usize) -> Vec<IndexedDocument> {
    let filler = [
        "planning", "notes", "meeting", "draft", "review", "budget", "travel", "recipe",
        "reading", "project",
    ];
    (0..documents)
        .map(|index| {
            let topic = filler[index % filler.len()];
            let content = format!(
                "# Note {index} about {topic}\n\n\
                 The {topic} conversation covered several follow-ups and open\n\
                 questions, including timelines and owners. See [[note-{prev}]]\n\
                 for the earlier thread.\n\n\
                 ## Details\n\nParagraph with shared vocabulary: apples, coffee,\n\
                 deadlines, weekend plans, and the word compose appearing often.\n\
                 {needle}",
                prev = index.saturating_sub(1),
                needle = if index == 617 { "The zanzibar needle sentence." } else { "" },
            );
            IndexedDocument::new(
                format!("doc-{index}"),
                format!("folder-{}/note-{index}.md", index % 50),
                format!("Note {index} about {topic}"),
                format!("hash-{index}"),
                content,
            )
        })
        .collect()
}

fn median_query_ms(snapshot: &workspace_index::WorkspaceIndexSnapshot, query: &str) -> f64 {
    // Warm once, then sample.
    search_snapshot(snapshot, query, 20);
    let mut timings: Vec<f64> = (0..9)
        .map(|_| {
            let started = Instant::now();
            let hits = search_snapshot(snapshot, query, 20);
            let elapsed = started.elapsed().as_secs_f64() * 1000.0;
            assert!(hits.len() <= 20);
            elapsed
        })
        .collect();
    timings.sort_by(|a, b| a.partial_cmp(b).unwrap());
    timings[timings.len() / 2]
}

#[test]
fn searches_a_thousand_note_snapshot_within_budget() {
    let documents = corpus(1000);

    let started = Instant::now();
    let snapshot = build_snapshot("bench".to_owned(), documents, 0, 0);
    let build_ms = started.elapsed().as_secs_f64() * 1000.0;

    let common = median_query_ms(&snapshot, "compose");
    let rare = median_query_ms(&snapshot, "zanzibar");
    let phrase = median_query_ms(&snapshot, "weekend plans");

    // The rare needle must actually be found — a benchmark that searches for
    // nothing measures nothing.
    let needle_hits = search_snapshot(&snapshot, "zanzibar", 20);
    assert!(!needle_hits.is_empty(), "needle document must be a hit");

    eprintln!(
        "search_bench: build={build_ms:.1}ms common={common:.2}ms rare={rare:.2}ms phrase={phrase:.2}ms"
    );

    // #70 budget: query ≤ 100ms. Generous CI ceiling at 5x budget.
    for (label, ms) in [("common", common), ("rare", rare), ("phrase", phrase)] {
        assert!(ms < 500.0, "{label} query took {ms:.1}ms — investigate");
    }
}
