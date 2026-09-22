//! The notes a workspace changed most recently, as places outside the app list
//! them: Shortcuts and the widget.

use rusqlite::params;

use super::{title_from_path, MetadataStore};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecentDocument {
    pub relative_path: String,
    pub title: String,
    /// Milliseconds since the epoch.
    pub modified_at: i64,
}

impl MetadataStore {
    /// Up to `limit` of `vault_id`'s notes, most recently changed first. None
    /// for a workspace whose metadata was never written, which is left uncreated.
    pub fn recent_documents(&self, vault_id: &str, limit: usize) -> Result<Vec<RecentDocument>, String> {
        let Some(connection) = self.existing_vault_connection(vault_id)? else {
            return Ok(Vec::new());
        };
        let mut statement = connection
            .prepare(
                "select current_path, title, coalesce(last_seen_mtime, updated_at) as modified_at
                 from documents
                 where deleted_at is null
                 order by modified_at desc, current_path
                 limit ?1",
            )
            .map_err(|error| format!("could not read recent documents: {error}"))?;
        let rows = statement
            .query_map(params![i64::try_from(limit).unwrap_or(i64::MAX)], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, i64>(2)?))
            })
            .map_err(|error| format!("could not read recent documents: {error}"))?;
        rows.map(|row| {
            let (relative_path, title, modified_at) =
                row.map_err(|error| format!("could not read a recent document: {error}"))?;
            let title = title
                .filter(|title| !title.trim().is_empty())
                .or_else(|| title_from_path(&relative_path))
                .unwrap_or_else(|| relative_path.clone());
            Ok(RecentDocument { relative_path, title, modified_at })
        })
        .collect()
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    fn store() -> (tempfile::TempDir, MetadataStore) {
        let dir = tempfile::tempdir().expect("dir");
        let store = MetadataStore::default();
        store.init_from_dir(dir.path()).expect("init");
        store.ensure_vault("v1", "Notes", Path::new("/vaults/notes")).expect("vault");
        (dir, store)
    }

    #[test]
    fn newest_first_without_deleted_notes_and_up_to_the_limit() {
        let (_dir, store) = store();
        store.record_document_written("v1", "old.md", "# Old", 10, 5).expect("old");
        store.record_document_written("v1", "folder/new.md", "# New one", 30, 9).expect("new");
        store.record_document_written("v1", "middle.md", "no heading", 20, 10).expect("middle");
        store.record_document_written("v1", "gone.md", "# Gone", 40, 6).expect("gone");
        store.mark_document_deleted("v1", "gone.md").expect("delete");

        let recent = store.recent_documents("v1", 10).expect("recent");
        let listed: Vec<_> = recent.iter().map(|note| (note.relative_path.as_str(), note.title.as_str())).collect();
        assert_eq!(listed, [("folder/new.md", "New one"), ("middle.md", "middle"), ("old.md", "Old")]);
        assert_eq!(recent[0].modified_at, 30);
        assert_eq!(store.recent_documents("v1", 1).expect("limited").len(), 1);
    }

    #[test]
    fn a_workspace_never_opened_has_none_and_is_not_created() {
        let (dir, store) = store();
        assert!(store.recent_documents("never-opened", 10).expect("recent").is_empty());
        assert!(!dir.path().join("vaults").join("never-opened").exists());
    }
}
