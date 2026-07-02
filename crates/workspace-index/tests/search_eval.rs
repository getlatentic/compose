//! Retrieval-quality eval (#79): judged queries over a controlled corpus,
//! scoring OUR ranker against an inline BM25 reference (the classic lexical
//! baseline — term saturation + length normalization, k1=1.2 b=0.75).
//!
//! Speed is already benchmarked (`search_bench`); this measures *ranking
//! quality*: Recall@10 and MRR per query intent, so weaknesses are legible
//! ("loses only on typo'd filenames") instead of vibes. Report-only asserts;
//! the printed table is what the issue/PERF notes cite.

use std::collections::HashMap;
use workspace_index::{build_snapshot, search_snapshot, IndexedDocument};

struct Judged {
    intent: &'static str,
    query: &'static str,
    /// Paths of the docs a good ranker should surface, best first.
    relevant: &'static [&'static str],
}

fn doc(path: &str, title: &str, content: &str) -> (String, String, String) {
    (path.to_owned(), title.to_owned(), content.to_owned())
}

/// Controlled corpus: a handful of docs with known-relevant content for the
/// judged queries, plus generic filler so ranking has something to beat.
/// Returned raw so the eval can feed both engines (IndexedDocument keeps its
/// content private).
fn corpus() -> Vec<(String, String, String)> {
    let mut docs = vec![
        doc(
            "Work/Meeting Notes Q3.md",
            "Meeting Notes Q3",
            "# Meeting Notes Q3\n\nBudget review, hiring plan, roadmap checkpoints.\n",
        ),
        doc(
            "Projects/Marketell/Data Pipeline.md",
            "Data Pipeline",
            "# Data Pipeline\n\nCustomer segmentation pipeline: ingestion, feature\nengineering, deduplication, and the Kaggle-style validation split.\n",
        ),
        doc(
            "Travel/Zanzibar Trip.md",
            "Zanzibar Trip",
            "# Zanzibar Trip\n\nFlights, visa notes, and the spice farm tour plan.\n",
        ),
        // The saturation probe: a SHORT doc genuinely about "budget"…
        doc(
            "Finance/Budget.md",
            "Budget",
            "# Budget\n\nThe budget: categories, monthly caps, and the review cadence.\n",
        ),
        // …vs a LONG doc that mentions "budget" incidentally many times.
        doc(
            "Archive/Yearly Review 2024.md",
            "Yearly Review 2024",
            &format!(
                "# Yearly Review 2024\n\n{}",
                "This quarter the budget came up in passing during planning.\n".repeat(40)
            ),
        ),
        doc(
            "Recipes/Jollof Rice.md",
            "Jollof Rice",
            "# Jollof Rice\n\nLong-grain rice, scotch bonnet, the party-size ratios.\n",
        ),
        doc(
            "Work/Hiring Plan.md",
            "Hiring Plan",
            "# Hiring Plan\n\nTwo backend roles and one designer in the second half.\n",
        ),
    ];
    for index in 0..200 {
        docs.push(doc(
            &format!("Filler/note-{index:03}.md"),
            &format!("Note {index}"),
            "# Note\n\nGeneric planning text with meetings, plans, and reviews\nmentioned in passing across the paragraphs.\n",
        ));
    }
    docs
}

fn judged_queries() -> Vec<Judged> {
    vec![
        Judged {
            intent: "exact filename",
            query: "meeting notes q3",
            relevant: &["Work/Meeting Notes Q3.md"],
        },
        Judged {
            intent: "typo'd filename",
            query: "meating notes",
            relevant: &["Work/Meeting Notes Q3.md"],
        },
        Judged {
            intent: "single rare term",
            query: "zanzibar",
            relevant: &["Travel/Zanzibar Trip.md"],
        },
        Judged {
            intent: "multi-term cross-field",
            query: "marketell segmentation",
            relevant: &["Projects/Marketell/Data Pipeline.md"],
        },
        Judged {
            intent: "phrase",
            query: "customer segmentation pipeline",
            relevant: &["Projects/Marketell/Data Pipeline.md"],
        },
        Judged {
            intent: "saturation (short focused vs long incidental)",
            query: "budget",
            relevant: &["Finance/Budget.md"],
        },
        Judged {
            intent: "common word, titled doc",
            query: "hiring",
            relevant: &["Work/Hiring Plan.md"],
        },
    ]
}

// ---- inline BM25 reference (content + title + path tokens as one field) ----

fn tokens(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_owned)
        .collect()
}

struct Bm25 {
    doc_tokens: Vec<(String, Vec<String>)>,
    doc_freq: HashMap<String, usize>,
    avg_len: f32,
}

impl Bm25 {
    fn build(docs: &[(String, String)]) -> Self {
        let doc_tokens: Vec<(String, Vec<String>)> = docs
            .iter()
            .map(|(path, text)| (path.clone(), tokens(text)))
            .collect();
        let mut doc_freq: HashMap<String, usize> = HashMap::new();
        for (_, toks) in &doc_tokens {
            let mut seen: Vec<&String> = toks.iter().collect();
            seen.sort();
            seen.dedup();
            for t in seen {
                *doc_freq.entry(t.clone()).or_default() += 1;
            }
        }
        let avg_len =
            doc_tokens.iter().map(|(_, t)| t.len()).sum::<usize>() as f32 / doc_tokens.len() as f32;
        Self { doc_tokens, doc_freq, avg_len }
    }

    fn search(&self, query: &str, limit: usize) -> Vec<String> {
        let (k1, b) = (1.2_f32, 0.75_f32);
        let n = self.doc_tokens.len() as f32;
        let q_tokens = tokens(query);
        let mut scored: Vec<(f32, &String)> = self
            .doc_tokens
            .iter()
            .map(|(path, toks)| {
                let len = toks.len() as f32;
                let score: f32 = q_tokens
                    .iter()
                    .map(|q| {
                        let tf = toks.iter().filter(|t| *t == q).count() as f32;
                        if tf == 0.0 {
                            return 0.0;
                        }
                        let df = *self.doc_freq.get(q).unwrap_or(&0) as f32;
                        let idf = ((n - df + 0.5) / (df + 0.5) + 1.0).ln();
                        idf * (tf * (k1 + 1.0)) / (tf + k1 * (1.0 - b + b * len / self.avg_len))
                    })
                    .sum();
                (score, path)
            })
            .filter(|(score, _)| *score > 0.0)
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.into_iter().take(limit).map(|(_, p)| p.clone()).collect()
    }
}

// ---- metrics ----

fn recall_at_10(ranked: &[String], relevant: &[&str]) -> f32 {
    let top: Vec<&String> = ranked.iter().take(10).collect();
    let hit = relevant.iter().filter(|r| top.iter().any(|p| p == *r)).count();
    hit as f32 / relevant.len() as f32
}

fn mrr(ranked: &[String], relevant: &[&str]) -> f32 {
    for (rank, path) in ranked.iter().enumerate() {
        if relevant.contains(&path.as_str()) {
            return 1.0 / (rank as f32 + 1.0);
        }
    }
    0.0
}

#[test]
fn judged_retrieval_quality_ours_vs_bm25() {
    let raw_docs = corpus();
    let raw: Vec<(String, String)> = raw_docs
        .iter()
        .map(|(path, title, content)| {
            (path.clone(), format!("{} {} {}", title, path.replace(['/', '-'], " "), content))
        })
        .collect();
    let documents: Vec<IndexedDocument> = raw_docs
        .iter()
        .map(|(path, title, content)| {
            IndexedDocument::new(
                format!("id:{path}"),
                path.clone(),
                title.clone(),
                format!("hash:{path}"),
                content.clone(),
            )
        })
        .collect();
    let snapshot = build_snapshot("eval".to_owned(), documents, 0, 0);
    let bm25 = Bm25::build(&raw);

    let mut ours_recall = 0.0;
    let mut ours_mrr = 0.0;
    let mut bm_recall = 0.0;
    let mut bm_mrr = 0.0;
    let queries = judged_queries();

    eprintln!("\nintent                                     | ours R@10  MRR | bm25 R@10  MRR");
    eprintln!("-------------------------------------------|----------------|---------------");
    for q in &queries {
        let ours: Vec<String> =
            search_snapshot(&snapshot, q.query, 10).into_iter().map(|h| h.path).collect();
        let bm: Vec<String> = bm25.search(q.query, 10);
        let (or10, omrr) = (recall_at_10(&ours, q.relevant), mrr(&ours, q.relevant));
        let (br10, bmrr) = (recall_at_10(&bm, q.relevant), mrr(&bm, q.relevant));
        ours_recall += or10;
        ours_mrr += omrr;
        bm_recall += br10;
        bm_mrr += bmrr;
        eprintln!(
            "{:<43}| {:>9.2} {:>4.2} | {:>9.2} {:>4.2}",
            q.intent, or10, omrr, br10, bmrr
        );
    }
    let n = queries.len() as f32;
    eprintln!("-------------------------------------------|----------------|---------------");
    eprintln!(
        "{:<43}| {:>9.2} {:>4.2} | {:>9.2} {:>4.2}\n",
        "MEAN",
        ours_recall / n,
        ours_mrr / n,
        bm_recall / n,
        bm_mrr / n
    );

    // Report-only spirit: assert only that the harness itself works — every
    // engine must find SOMETHING for the trivially-findable rare term.
    assert!(mrr(
        &search_snapshot(&snapshot, "zanzibar", 10).into_iter().map(|h| h.path).collect::<Vec<_>>(),
        &["Travel/Zanzibar Trip.md"]
    ) > 0.0);
}
