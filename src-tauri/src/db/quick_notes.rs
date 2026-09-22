//! Quick notes: what the user has jotted in the quick-note window and not yet
//! saved into a workspace. Several can wait at once; each is kept as it is
//! typed, so closing the window or quitting loses none of them.

use rusqlite::params;
use serde::Serialize;

use super::{now_ms, MetadataStore};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuickNote {
    pub id: String,
    pub body: String,
    pub created_at: i64,
    pub updated_at: i64,
}

impl MetadataStore {
    /// Every quick note, the newest first.
    pub fn quick_notes(&self) -> Result<Vec<QuickNote>, String> {
        let connection = self.app_connection()?;
        let mut statement = connection
            .prepare("select id, body, created_at, updated_at from quick_notes order by created_at desc, id")
            .map_err(|error| format!("could not read quick notes: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok(QuickNote {
                    id: row.get(0)?,
                    body: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            })
            .map_err(|error| format!("could not read quick notes: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("could not read quick notes: {error}"))
    }

    /// Keep `body` as the text of quick note `id`, making the note if it is new.
    pub fn save_quick_note(&self, id: &str, body: &str) -> Result<QuickNote, String> {
        let now = now_ms();
        let connection = self.app_connection()?;
        connection
            .execute(
                "insert into quick_notes (id, body, created_at, updated_at) values (?1, ?2, ?3, ?3)
                 on conflict(id) do update set body = excluded.body, updated_at = excluded.updated_at",
                params![id, body, now],
            )
            .map_err(|error| format!("could not keep a quick note: {error}"))?;
        connection
            .query_row(
                "select id, body, created_at, updated_at from quick_notes where id = ?1",
                params![id],
                |row| {
                    Ok(QuickNote {
                        id: row.get(0)?,
                        body: row.get(1)?,
                        created_at: row.get(2)?,
                        updated_at: row.get(3)?,
                    })
                },
            )
            .map_err(|error| format!("could not read a quick note: {error}"))
    }

    pub fn delete_quick_note(&self, id: &str) -> Result<(), String> {
        self.app_connection()?
            .execute("delete from quick_notes where id = ?1", params![id])
            .map_err(|error| format!("could not delete a quick note: {error}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (MetadataStore, tempfile::TempDir) {
        let dir = tempfile::tempdir().expect("tempdir");
        let store = MetadataStore::default();
        store.init_from_dir(dir.path()).expect("init");
        (store, dir)
    }

    #[test]
    fn quick_notes_are_kept_as_typed_and_listed_newest_first() {
        let (store, _dir) = store();
        store.save_quick_note("older", "Groceries").expect("save");
        std::thread::sleep(std::time::Duration::from_millis(2));
        store.save_quick_note("newer", "Call Ada").expect("save");
        let edited = store.save_quick_note("older", "Groceries: eggs").expect("edit");
        assert_eq!(edited.body, "Groceries: eggs");
        assert!(edited.updated_at >= edited.created_at);
        let bodies: Vec<String> = store.quick_notes().expect("list").into_iter().map(|note| note.body).collect();
        assert_eq!(bodies, ["Call Ada", "Groceries: eggs"], "editing does not reorder the list");
    }

    #[test]
    fn a_deleted_quick_note_is_gone() {
        let (store, _dir) = store();
        store.save_quick_note("a", "Draft").expect("save");
        store.delete_quick_note("a").expect("delete");
        assert!(store.quick_notes().expect("list").is_empty());
    }
}
