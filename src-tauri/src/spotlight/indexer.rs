//! Keeping Spotlight's copy of the notes current, one job at a time.

use std::path::Path;

use super::note::{self, SearchableNote};
use super::plan;
use crate::db::MetadataStore;
use crate::workspace::{WorkspaceRecord, WorkspaceRegistry};

/// Notes handed to Spotlight at a time.
const BATCH: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Job {
    /// Bring a workspace's notes up to date, sending only what changed.
    Reconcile(String),
    Written { workspace_id: String, path: String },
    Renamed { workspace_id: String, from: String, to: String },
    Deleted { workspace_id: String, path: String },
    /// A workspace was removed from Compose.
    Forget(String),
    /// The user turned Spotlight off.
    ForgetAll,
}

/// Spotlight's index, behind a seam so the jobs can be tested without it.
pub(super) trait SearchIndex {
    fn index(&self, notes: &[SearchableNote]) -> Result<(), String>;
    fn delete(&self, ids: &[String]) -> Result<(), String>;
    fn delete_workspace(&self, workspace_id: &str) -> Result<(), String>;
    fn delete_everything(&self) -> Result<(), String>;
}

pub(super) struct Indexer<'a, I: SearchIndex> {
    pub index: &'a I,
    pub metadata: &'a MetadataStore,
    pub registry: &'a WorkspaceRegistry,
}

impl<I: SearchIndex> Indexer<'_, I> {
    pub fn run(&self, job: Job) -> Result<(), String> {
        match job {
            Job::Reconcile(workspace_id) => self.reconcile(&workspace_id),
            Job::Written { workspace_id, path } => self.send_paths(&workspace_id, &[path]),
            Job::Renamed { workspace_id, from, to } => {
                self.drop_paths(&workspace_id, vec![from])?;
                self.send_paths(&workspace_id, &[to])
            }
            Job::Deleted { workspace_id, path } => self.drop_paths(&workspace_id, vec![path]),
            Job::Forget(workspace_id) => {
                self.index.delete_workspace(&workspace_id)?;
                self.metadata.forget_spotlight_vault(Some(&workspace_id))
            }
            Job::ForgetAll => {
                self.index.delete_everything()?;
                self.metadata.forget_spotlight_vault(None)
            }
        }
    }

    fn reconcile(&self, workspace_id: &str) -> Result<(), String> {
        let documents = self.metadata.indexable_documents(workspace_id)?;
        let sent = self.metadata.spotlight_items(workspace_id)?;
        let plan = plan::reconcile(documents, &sent);
        self.drop_paths(workspace_id, plan.drop)?;
        self.send(workspace_id, plan.send)
    }

    fn send_paths(&self, workspace_id: &str, paths: &[String]) -> Result<(), String> {
        let documents = self.metadata.indexable_documents_at(workspace_id, paths)?;
        self.send(workspace_id, documents)
    }

    fn send(&self, workspace_id: &str, documents: Vec<crate::db::IndexableDocument>) -> Result<(), String> {
        let Some(workspace) = self.workspace(workspace_id)? else {
            return Ok(());
        };
        for batch in documents.chunks(BATCH) {
            let notes: Vec<SearchableNote> = batch.iter().filter_map(|document| note::read(&workspace, document)).collect();
            if notes.is_empty() {
                continue;
            }
            self.index.index(&notes)?;
            let sent: Vec<(String, String)> =
                notes.into_iter().map(|note| (note.relative_path, note.content_hash)).collect();
            self.metadata.record_spotlight_items(workspace_id, &sent)?;
        }
        Ok(())
    }

    fn drop_paths(&self, workspace_id: &str, paths: Vec<String>) -> Result<(), String> {
        if paths.is_empty() {
            return Ok(());
        }
        let Some(workspace) = self.workspace(workspace_id)? else {
            return Ok(());
        };
        let root = Path::new(&workspace.path);
        let ids: Vec<String> = paths.iter().map(|path| root.join(path).to_string_lossy().into_owned()).collect();
        self.index.delete(&ids)?;
        self.metadata.forget_spotlight_items(workspace_id, &paths)
    }

    fn workspace(&self, workspace_id: &str) -> Result<Option<WorkspaceRecord>, String> {
        Ok(self.registry.list()?.workspaces.into_iter().find(|workspace| workspace.id == workspace_id))
    }
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;
    use std::collections::BTreeMap;
    use std::fs;

    use super::*;

    /// Spotlight as a map from id to title and summary.
    #[derive(Default)]
    struct Remembered {
        items: RefCell<BTreeMap<String, (String, String, String)>>,
        indexed: RefCell<usize>,
    }

    impl SearchIndex for Remembered {
        fn index(&self, notes: &[SearchableNote]) -> Result<(), String> {
            *self.indexed.borrow_mut() += notes.len();
            let mut items = self.items.borrow_mut();
            for note in notes {
                items.insert(note.id.clone(), (note.workspace_id.clone(), note.title.clone(), note.summary.clone()));
            }
            Ok(())
        }

        fn delete(&self, ids: &[String]) -> Result<(), String> {
            let mut items = self.items.borrow_mut();
            ids.iter().for_each(|id| {
                items.remove(id);
            });
            Ok(())
        }

        fn delete_workspace(&self, workspace_id: &str) -> Result<(), String> {
            self.items.borrow_mut().retain(|_, (workspace, _, _)| workspace != workspace_id);
            Ok(())
        }

        fn delete_everything(&self) -> Result<(), String> {
            self.items.borrow_mut().clear();
            Ok(())
        }
    }

    struct Fixture {
        registry: WorkspaceRegistry,
        metadata: MetadataStore,
        root: std::path::PathBuf,
        _dirs: Vec<tempfile::TempDir>,
    }

    impl Fixture {
        fn new() -> Self {
            let [config, data, vault] = [(); 3].map(|()| tempfile::tempdir().expect("dir"));
            let registry = WorkspaceRegistry::default();
            registry.init_from_dir(config.path()).expect("registry");
            let list = registry.add(vault.path().to_string_lossy().into_owned()).expect("add");
            let metadata = MetadataStore::default();
            metadata.init_from_dir(data.path()).expect("metadata");
            let workspace = &list.workspaces[0];
            let root = std::path::PathBuf::from(&workspace.path);
            metadata.ensure_vault(&workspace.id, &workspace.name, &root).expect("vault");
            Self { registry, metadata, root, _dirs: vec![config, data, vault] }
        }

        fn workspace_id(&self) -> String {
            self.registry.list().expect("list").workspaces[0].id.clone()
        }

        fn write(&self, path: &str, content: &str) {
            let absolute = self.root.join(path);
            fs::create_dir_all(absolute.parent().expect("parent")).expect("dir");
            fs::write(&absolute, content).expect("write");
            self.metadata.record_document_written(&self.workspace_id(), path, content, 1, content.len() as u64).expect("record");
        }

        fn id(&self, path: &str) -> String {
            self.root.join(path).to_string_lossy().into_owned()
        }

        fn run(&self, index: &Remembered, job: Job) {
            Indexer { index, metadata: &self.metadata, registry: &self.registry }.run(job).expect("job");
        }
    }

    #[test]
    fn a_workspace_is_indexed_once_and_then_only_what_changed() {
        let fixture = Fixture::new();
        fixture.write("a.md", "# Alpha\n\nFirst.");
        fixture.write("ideas/b.md", "# Beta\n\nSecond.");
        let index = Remembered::default();

        fixture.run(&index, Job::Reconcile(fixture.workspace_id()));
        assert_eq!(index.items.borrow().get(&fixture.id("ideas/b.md")).map(|item| item.1.as_str()), Some("Beta"));
        assert_eq!(*index.indexed.borrow(), 2);

        fixture.run(&index, Job::Reconcile(fixture.workspace_id()));
        assert_eq!(*index.indexed.borrow(), 2, "nothing changed, nothing is resent");

        fixture.write("a.md", "# Alpha\n\nRewritten.");
        fixture.run(&index, Job::Reconcile(fixture.workspace_id()));
        assert_eq!(*index.indexed.borrow(), 3);
        assert_eq!(index.items.borrow()[&fixture.id("a.md")].2, "Rewritten.");
    }

    #[test]
    fn a_rename_moves_the_item_and_a_delete_drops_it() {
        let fixture = Fixture::new();
        let workspace_id = fixture.workspace_id();
        fixture.write("a.md", "# Alpha");
        let index = Remembered::default();
        fixture.run(&index, Job::Written { workspace_id: workspace_id.clone(), path: "a.md".to_owned() });

        fs::rename(fixture.root.join("a.md"), fixture.root.join("b.md")).expect("rename");
        fixture.metadata.rename_document(&workspace_id, "a.md", "b.md").expect("rename record");
        fixture.run(&index, Job::Renamed { workspace_id: workspace_id.clone(), from: "a.md".to_owned(), to: "b.md".to_owned() });
        assert_eq!(index.items.borrow().keys().cloned().collect::<Vec<_>>(), [fixture.id("b.md")]);

        fixture.metadata.mark_document_deleted(&workspace_id, "b.md").expect("delete record");
        fixture.run(&index, Job::Deleted { workspace_id: workspace_id.clone(), path: "b.md".to_owned() });
        assert!(index.items.borrow().is_empty());
        assert!(fixture.metadata.spotlight_items(&workspace_id).expect("items").is_empty());
    }

    #[test]
    fn a_deleted_note_found_by_a_later_scan_is_dropped() {
        let fixture = Fixture::new();
        let workspace_id = fixture.workspace_id();
        fixture.write("a.md", "# Alpha");
        let index = Remembered::default();
        fixture.run(&index, Job::Reconcile(workspace_id.clone()));
        fixture.metadata.mark_document_deleted(&workspace_id, "a.md").expect("delete record");
        fixture.run(&index, Job::Reconcile(workspace_id));
        assert!(index.items.borrow().is_empty());
    }

    #[test]
    fn a_removed_workspace_and_turning_spotlight_off_empty_it() {
        let fixture = Fixture::new();
        let workspace_id = fixture.workspace_id();
        fixture.write("a.md", "# Alpha");
        let index = Remembered::default();
        fixture.run(&index, Job::Reconcile(workspace_id.clone()));
        fixture.run(&index, Job::Forget(workspace_id.clone()));
        assert!(index.items.borrow().is_empty());
        assert!(fixture.metadata.spotlight_vaults().expect("vaults").is_empty());

        fixture.run(&index, Job::Reconcile(workspace_id));
        fixture.run(&index, Job::ForgetAll);
        assert!(index.items.borrow().is_empty() && fixture.metadata.spotlight_vaults().expect("vaults").is_empty());
    }

    #[test]
    fn a_note_that_cannot_be_read_waits_for_a_later_pass() {
        let fixture = Fixture::new();
        let workspace_id = fixture.workspace_id();
        fixture.write("a.md", "# Alpha");
        fs::remove_file(fixture.root.join("a.md")).expect("remove");
        let index = Remembered::default();
        fixture.run(&index, Job::Reconcile(workspace_id.clone()));
        assert!(index.items.borrow().is_empty());
        assert!(fixture.metadata.spotlight_items(&workspace_id).expect("items").is_empty(), "not recorded as sent");
    }
}
