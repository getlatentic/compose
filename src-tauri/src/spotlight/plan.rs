//! Bringing Spotlight up to date with a workspace without resending every note.

use std::collections::{HashMap, HashSet};

use crate::db::IndexableDocument;

#[derive(Debug, Default, PartialEq, Eq)]
pub(super) struct Plan {
    pub send: Vec<IndexableDocument>,
    pub drop: Vec<String>,
}

/// What to send Spotlight and what to tell it to drop so that it holds
/// `documents` as they are now, given what it was last sent: each note's
/// content hash, by path.
pub(super) fn reconcile(documents: Vec<IndexableDocument>, sent: &HashMap<String, String>) -> Plan {
    let live: HashSet<String> = documents.iter().map(|document| document.relative_path.clone()).collect();
    let mut drop: Vec<String> = sent.keys().filter(|path| !live.contains(*path)).cloned().collect();
    drop.sort();
    let send = documents
        .into_iter()
        .filter(|document| sent.get(&document.relative_path) != Some(&document.content_hash))
        .collect();
    Plan { send, drop }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document(path: &str, hash: &str) -> IndexableDocument {
        IndexableDocument { relative_path: path.to_owned(), title: path.to_owned(), content_hash: hash.to_owned(), modified_at: 0 }
    }

    #[test]
    fn only_new_and_changed_notes_are_sent_and_gone_ones_dropped() {
        let sent = HashMap::from([
            ("same.md".to_owned(), "h1".to_owned()),
            ("changed.md".to_owned(), "old".to_owned()),
            ("gone.md".to_owned(), "h3".to_owned()),
        ]);
        let plan = reconcile(
            vec![document("same.md", "h1"), document("changed.md", "new"), document("new.md", "h4")],
            &sent,
        );
        let sent_paths: Vec<_> = plan.send.iter().map(|document| document.relative_path.as_str()).collect();
        assert_eq!(sent_paths, ["changed.md", "new.md"]);
        assert_eq!(plan.drop, ["gone.md"]);
    }

    #[test]
    fn a_workspace_indexed_as_it_is_needs_nothing() {
        let sent = HashMap::from([("a.md".to_owned(), "h".to_owned())]);
        assert_eq!(reconcile(vec![document("a.md", "h")], &sent), Plan::default());
    }
}
