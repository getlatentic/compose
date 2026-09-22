//! What changed among a workspace's notes, for what mirrors them outside the
//! app. Told after the change is committed, so a listener reading the store
//! sees it.

use super::MetadataStore;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocumentChange {
    /// A scan brought every note in the workspace up to date with the disk.
    Synced,
    Written(String),
    Renamed { from: String, to: String },
    Deleted(String),
}

pub(super) type DocumentObserver = Box<dyn Fn(&str, &DocumentChange) + Send + Sync>;

impl MetadataStore {
    /// Hear of every change to any workspace's notes, with the workspace's id.
    pub fn observe_documents(&self, observer: impl Fn(&str, &DocumentChange) + Send + Sync + 'static) {
        let _ = self.document_observer.set(Box::new(observer));
    }

    pub(super) fn notify_documents(&self, vault_id: &str, change: &DocumentChange) {
        if let Some(observer) = self.document_observer.get() {
            observer(vault_id, change);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::db::DocumentInventoryEntry;

    #[test]
    fn every_kind_of_change_is_told_once_committed() {
        let dir = tempfile::tempdir().expect("dir");
        let store = Arc::new(MetadataStore::default());
        store.init_from_dir(dir.path()).expect("init");
        store.ensure_vault("v1", "Notes", Path::new("/vaults/notes")).expect("vault");
        let heard = Arc::new(Mutex::new(Vec::new()));
        let (listener, reader) = (Arc::clone(&heard), Arc::clone(&store));
        store.observe_documents(move |vault, change| {
            let titles = reader.recent_documents(vault, 10).expect("readable while told");
            listener.lock().unwrap().push((vault.to_owned(), change.clone(), titles.len()));
        });

        store.record_document_written("v1", "a.md", "# A", 1, 3).expect("write");
        store.rename_document("v1", "a.md", "b.md").expect("rename");
        store.mark_document_deleted("v1", "b.md").expect("delete");
        store
            .sync_documents(
                "v1",
                vec![DocumentInventoryEntry {
                    content_hash: crate::db::content_hash("c"),
                    last_seen_mtime: 2,
                    last_seen_size: 1,
                    relative_path: "c.md".to_owned(),
                    title: None,
                }],
            )
            .expect("sync");

        let heard = heard.lock().unwrap();
        let vault = |change: DocumentChange, notes: usize| ("v1".to_owned(), change, notes);
        assert_eq!(
            *heard,
            [
                vault(DocumentChange::Written("a.md".to_owned()), 1),
                vault(DocumentChange::Renamed { from: "a.md".to_owned(), to: "b.md".to_owned() }, 1),
                vault(DocumentChange::Deleted("b.md".to_owned()), 0),
                vault(DocumentChange::Synced, 1),
            ]
        );
    }
}
