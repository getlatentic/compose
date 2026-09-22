//! The notes Shortcuts and the widget can offer: those changed most recently
//! across every workspace.

use std::path::Path;

use super::contract::{NotesIndex, PublishedNote, CONTRACT_VERSION};
use crate::db::MetadataStore;
use crate::workspace::WorkspaceList;

/// Enough to find any note of an ordinary collection by name, small enough to
/// read at every Shortcuts lookup and widget refresh.
pub(super) const MOST_NOTES: usize = 1000;

pub(super) fn index(list: &WorkspaceList, metadata: &MetadataStore) -> NotesIndex {
    let mut notes = Vec::new();
    for workspace in &list.workspaces {
        let recent = match metadata.recent_documents(&workspace.id, MOST_NOTES) {
            Ok(recent) => recent,
            Err(error) => {
                eprintln!("notes of workspace {} are not published: {error}", workspace.id);
                continue;
            }
        };
        let root = Path::new(&workspace.path);
        notes.extend(recent.into_iter().map(|document| PublishedNote {
            path: root.join(&document.relative_path).to_string_lossy().into_owned(),
            title: document.title,
            workspace_id: workspace.id.clone(),
            workspace_name: workspace.name.clone(),
            modified_at: document.modified_at,
        }));
    }
    notes.sort_by(|a, b| b.modified_at.cmp(&a.modified_at).then_with(|| a.path.cmp(&b.path)));
    notes.truncate(MOST_NOTES);
    NotesIndex { version: CONTRACT_VERSION, notes }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::WorkspaceRecord;

    fn workspace(id: &str, name: &str) -> WorkspaceRecord {
        WorkspaceRecord {
            id: id.to_owned(),
            name: name.to_owned(),
            path: format!("/vaults/{name}"),
            tabs: None,
            last_opened_at: None,
        }
    }

    #[test]
    fn every_workspace_newest_first_with_absolute_paths() {
        let dir = tempfile::tempdir().expect("dir");
        let metadata = MetadataStore::default();
        metadata.init_from_dir(dir.path()).expect("init");
        for (id, name) in [("w1", "Notes"), ("w2", "Thesis")] {
            metadata.ensure_vault(id, name, Path::new(&format!("/vaults/{name}"))).expect("vault");
        }
        metadata.record_document_written("w1", "a.md", "# Alpha", 10, 7).expect("a");
        metadata.record_document_written("w2", "ch/1.md", "# Chapter one", 20, 13).expect("1");
        let list = WorkspaceList {
            active_workspace_id: Some("w1".to_owned()),
            onboarding: Default::default(),
            workspaces: vec![workspace("w1", "Notes"), workspace("w2", "Thesis"), workspace("w3", "Unopened")],
        };

        let index = index(&list, &metadata);
        let listed: Vec<_> = index
            .notes
            .iter()
            .map(|note| (note.path.as_str(), note.title.as_str(), note.workspace_name.as_str()))
            .collect();
        assert_eq!(listed, [("/vaults/Thesis/ch/1.md", "Chapter one", "Thesis"), ("/vaults/Notes/a.md", "Alpha", "Notes")]);
    }
}
