//! The notes Spotlight should hold, and what Compose last gave it.

use std::collections::HashMap;

use rusqlite::{params, OptionalExtension};

use super::{title_from_path, MetadataStore};

/// A note as Spotlight lists it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexableDocument {
    pub relative_path: String,
    pub title: String,
    pub content_hash: String,
    /// Milliseconds since the epoch.
    pub modified_at: i64,
}

impl MetadataStore {
    /// Every note `vault_id` holds. None for a workspace whose metadata was
    /// never written.
    pub fn indexable_documents(&self, vault_id: &str) -> Result<Vec<IndexableDocument>, String> {
        let Some(connection) = self.existing_vault_connection(vault_id)? else {
            return Ok(Vec::new());
        };
        let mut statement = connection
            .prepare(
                "select current_path, title, content_hash, coalesce(last_seen_mtime, updated_at)
                 from documents
                 where deleted_at is null",
            )
            .map_err(|error| format!("could not read documents for Spotlight: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)?))
            })
            .map_err(|error| format!("could not read documents for Spotlight: {error}"))?;
        rows.map(|row| {
            let (relative_path, title, content_hash, modified_at) =
                row.map_err(|error| format!("could not read a document for Spotlight: {error}"))?;
            Ok(document(relative_path, title, content_hash, modified_at))
        })
        .collect()
    }

    /// The notes at `relative_paths` that `vault_id` still holds.
    pub fn indexable_documents_at(
        &self,
        vault_id: &str,
        relative_paths: &[String],
    ) -> Result<Vec<IndexableDocument>, String> {
        let Some(connection) = self.existing_vault_connection(vault_id)? else {
            return Ok(Vec::new());
        };
        let mut statement = connection
            .prepare(
                "select current_path, title, content_hash, coalesce(last_seen_mtime, updated_at)
                 from documents
                 where deleted_at is null and current_path = ?1",
            )
            .map_err(|error| format!("could not read documents for Spotlight: {error}"))?;
        let mut documents = Vec::new();
        for relative_path in relative_paths {
            let found = statement
                .query_row(params![relative_path], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?, row.get::<_, String>(2)?, row.get::<_, i64>(3)?))
                })
                .optional()
                .map_err(|error| format!("could not read a document for Spotlight: {error}"))?;
            documents.extend(found.map(|(relative_path, title, content_hash, modified_at)| document(relative_path, title, content_hash, modified_at)));
        }
        Ok(documents)
    }

    /// What Spotlight was given for `vault_id`: each note's content hash, by path.
    pub fn spotlight_items(&self, vault_id: &str) -> Result<HashMap<String, String>, String> {
        let connection = self.app_connection()?;
        let mut statement = connection
            .prepare("select relative_path, content_hash from spotlight_items where vault_id = ?1")
            .map_err(|error| format!("could not read Spotlight items: {error}"))?;
        let rows = statement
            .query_map(params![vault_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|error| format!("could not read Spotlight items: {error}"))?;
        rows.collect::<Result<_, _>>().map_err(|error| format!("could not read a Spotlight item: {error}"))
    }

    /// The workspaces Spotlight holds notes of.
    pub fn spotlight_vaults(&self) -> Result<Vec<String>, String> {
        let connection = self.app_connection()?;
        let mut statement = connection
            .prepare("select distinct vault_id from spotlight_items")
            .map_err(|error| format!("could not read Spotlight workspaces: {error}"))?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| format!("could not read Spotlight workspaces: {error}"))?;
        rows.collect::<Result<_, _>>().map_err(|error| format!("could not read a Spotlight workspace: {error}"))
    }

    pub fn record_spotlight_items(&self, vault_id: &str, items: &[(String, String)]) -> Result<(), String> {
        let mut connection = self.app_connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("could not record Spotlight items: {error}"))?;
        for (relative_path, content_hash) in items {
            transaction
                .execute(
                    "insert into spotlight_items (vault_id, relative_path, content_hash) values (?1, ?2, ?3)
                     on conflict(vault_id, relative_path) do update set content_hash = excluded.content_hash",
                    params![vault_id, relative_path, content_hash],
                )
                .map_err(|error| format!("could not record a Spotlight item: {error}"))?;
        }
        transaction.commit().map_err(|error| format!("could not record Spotlight items: {error}"))
    }

    pub fn forget_spotlight_items(&self, vault_id: &str, relative_paths: &[String]) -> Result<(), String> {
        let mut connection = self.app_connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("could not forget Spotlight items: {error}"))?;
        for relative_path in relative_paths {
            transaction
                .execute(
                    "delete from spotlight_items where vault_id = ?1 and relative_path = ?2",
                    params![vault_id, relative_path],
                )
                .map_err(|error| format!("could not forget a Spotlight item: {error}"))?;
        }
        transaction.commit().map_err(|error| format!("could not forget Spotlight items: {error}"))
    }

    /// Forget one workspace's items, or every workspace's when `vault_id` is `None`.
    pub fn forget_spotlight_vault(&self, vault_id: Option<&str>) -> Result<(), String> {
        let connection = self.app_connection()?;
        match vault_id {
            Some(vault_id) => connection.execute("delete from spotlight_items where vault_id = ?1", params![vault_id]),
            None => connection.execute("delete from spotlight_items", []),
        }
        .map(|_| ())
        .map_err(|error| format!("could not forget Spotlight items: {error}"))
    }
}

/// A note named by its title, else its file.
fn document(relative_path: String, title: Option<String>, content_hash: String, modified_at: i64) -> IndexableDocument {
    let title = title
        .filter(|title| !title.trim().is_empty())
        .or_else(|| title_from_path(&relative_path))
        .unwrap_or_else(|| relative_path.clone());
    IndexableDocument { relative_path, title, content_hash, modified_at }
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
    fn every_live_note_is_indexable_with_its_hash() {
        let (_dir, store) = store();
        store.record_document_written("v1", "a.md", "# Alpha", 10, 7).expect("a");
        store.record_document_written("v1", "gone.md", "# Gone", 20, 6).expect("gone");
        store.mark_document_deleted("v1", "gone.md").expect("delete");
        let documents = store.indexable_documents("v1").expect("documents");
        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].title, "Alpha");
        assert_eq!(documents[0].content_hash, crate::db::content_hash("# Alpha"));
        assert!(store.indexable_documents("never-opened").expect("none").is_empty());

        let named = store
            .indexable_documents_at("v1", &["a.md".to_owned(), "gone.md".to_owned(), "missing.md".to_owned()])
            .expect("named");
        assert_eq!(named.iter().map(|document| document.relative_path.as_str()).collect::<Vec<_>>(), ["a.md"]);
    }

    #[test]
    fn what_spotlight_was_given_is_kept_per_workspace() {
        let (_dir, store) = store();
        store
            .record_spotlight_items("v1", &[("a.md".to_owned(), "h1".to_owned()), ("b.md".to_owned(), "h2".to_owned())])
            .expect("record");
        store.record_spotlight_items("v1", &[("a.md".to_owned(), "h3".to_owned())]).expect("update");
        store.record_spotlight_items("v2", &[("c.md".to_owned(), "h4".to_owned())]).expect("other");
        store.forget_spotlight_items("v1", &["b.md".to_owned()]).expect("forget");

        let v1 = store.spotlight_items("v1").expect("v1");
        assert_eq!(v1, HashMap::from([("a.md".to_owned(), "h3".to_owned())]));
        let mut vaults = store.spotlight_vaults().expect("vaults");
        vaults.sort();
        assert_eq!(vaults, ["v1", "v2"]);

        store.forget_spotlight_vault(Some("v1")).expect("forget v1");
        assert!(store.spotlight_items("v1").expect("v1").is_empty());
        store.forget_spotlight_vault(None).expect("forget all");
        assert!(store.spotlight_vaults().expect("vaults").is_empty());
    }
}
