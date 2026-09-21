//! App-wide settings that Rust needs before any window has loaded — a global
//! shortcut has to be registered at launch — kept as JSON values by key.

use rusqlite::{params, OptionalExtension};
use serde::de::DeserializeOwned;
use serde::Serialize;

use super::{now_ms, MetadataStore};

impl MetadataStore {
    /// The value stored under `key`; `None` when it was never set.
    pub fn app_setting<T: DeserializeOwned>(&self, key: &str) -> Result<Option<T>, String> {
        let connection = self.app_connection()?;
        let json: Option<String> = connection
            .query_row(
                "select value_json from app_settings where key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("could not read setting {key}: {error}"))?;
        json.map(|json| {
            serde_json::from_str(&json).map_err(|error| format!("setting {key} is unreadable: {error}"))
        })
        .transpose()
    }

    pub fn set_app_setting<T: Serialize>(&self, key: &str, value: &T) -> Result<(), String> {
        let json = serde_json::to_string(value)
            .map_err(|error| format!("could not encode setting {key}: {error}"))?;
        self.app_connection()?
            .execute(
                "insert into app_settings (key, value_json, updated_at) values (?1, ?2, ?3)
                 on conflict(key) do update set value_json = excluded.value_json,
                                                updated_at = excluded.updated_at",
                params![key, json, now_ms()],
            )
            .map_err(|error| format!("could not save setting {key}: {error}"))?;
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
    fn a_setting_never_set_is_absent() {
        let (store, _dir) = store();
        assert_eq!(store.app_setting::<String>("missing").expect("read"), None);
    }

    #[test]
    fn a_setting_reads_back_as_it_was_saved_and_can_be_replaced() {
        let (store, _dir) = store();
        store.set_app_setting("shortcut", &"Control+Alt+KeyN").expect("save");
        store.set_app_setting("shortcut", &"Alt+Space").expect("replace");
        assert_eq!(
            store.app_setting::<String>("shortcut").expect("read").as_deref(),
            Some("Alt+Space")
        );
    }
}
