//! What the user copied, kept in the app database when they turn clipboard
//! history on. A copy seen again moves to the top instead of repeating, and the
//! oldest unpinned copies go once there are more than the history keeps.

use rusqlite::{params, OptionalExtension, Row};
use serde::Serialize;

use super::{now_ms, MetadataStore};

/// How much text a history entry shows before its full content is asked for.
const PREVIEW_CHARS: usize = 400;

/// A copy as the watcher hands it over, ready to keep.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewClipboardItem {
    pub kind: ClipboardKind,
    /// The plain text, a link, or file paths one per line; empty for an image.
    pub text: String,
    pub html: Option<String>,
    pub image_png: Option<Vec<u8>>,
    /// Same content, same fingerprint: how a repeated copy is recognised.
    pub fingerprint: String,
    pub source_name: Option<String>,
    pub source_bundle: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClipboardKind {
    Text,
    Link,
    Image,
    Files,
}

impl ClipboardKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Link => "link",
            Self::Image => "image",
            Self::Files => "files",
        }
    }

    fn parse(value: &str) -> Self {
        match value {
            "link" => Self::Link,
            "image" => Self::Image,
            "files" => Self::Files,
            _ => Self::Text,
        }
    }
}

/// An entry as the history list shows it: the start of its text, not all of it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardSummary {
    pub id: String,
    pub kind: ClipboardKind,
    pub preview: String,
    pub characters: usize,
    pub rich: bool,
    pub source_name: Option<String>,
    pub copied_at: i64,
    pub pinned: bool,
}

/// An entry with everything it holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClipboardItem {
    pub id: String,
    pub kind: ClipboardKind,
    pub text: String,
    pub html: Option<String>,
    pub image_png: Option<Vec<u8>>,
}

impl MetadataStore {
    /// Keep a copy, or move the same content back to the top, then let go of the
    /// oldest unpinned entries beyond `keep`. Returns the entry's id.
    pub fn remember_copy(&self, item: &NewClipboardItem, id: &str, keep: usize) -> Result<String, String> {
        let mut connection = self.app_connection()?;
        let transaction = connection
            .transaction()
            .map_err(|error| format!("could not open clipboard history: {error}"))?;
        let now = now_ms();
        transaction
            .execute(
                "insert into clipboard_items
                   (id, kind, text, html, image, fingerprint, source_name, source_bundle, copied_at, pinned)
                 values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)
                 on conflict(fingerprint) do update set copied_at = excluded.copied_at",
                params![
                    id,
                    item.kind.as_str(),
                    item.text,
                    item.html,
                    item.image_png,
                    item.fingerprint,
                    item.source_name,
                    item.source_bundle,
                    now
                ],
            )
            .map_err(|error| format!("could not keep a copy: {error}"))?;
        let kept: String = transaction
            .query_row(
                "select id from clipboard_items where fingerprint = ?1",
                params![item.fingerprint],
                |row| row.get(0),
            )
            .map_err(|error| format!("could not read clipboard history: {error}"))?;
        transaction
            .execute(
                "delete from clipboard_items where pinned = 0 and id not in
                   (select id from clipboard_items where pinned = 0 order by copied_at desc limit ?1)",
                params![keep as i64],
            )
            .map_err(|error| format!("could not trim clipboard history: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("could not save clipboard history: {error}"))?;
        Ok(kept)
    }

    /// Pinned entries first, then the most recent; only those whose text holds
    /// `query`, ignoring case, when there is one.
    pub fn clipboard_items(&self, query: &str, limit: usize) -> Result<Vec<ClipboardSummary>, String> {
        let connection = self.app_connection()?;
        let pattern = format!("%{}%", escape_like(query.trim()));
        let mut statement = connection
            .prepare(
                "select id, kind, substr(text, 1, ?1), length(text), html is not null, source_name, copied_at, pinned
                 from clipboard_items
                 where text like ?2 escape '\\'
                 order by pinned desc, copied_at desc
                 limit ?3",
            )
            .map_err(|error| format!("could not read clipboard history: {error}"))?;
        let rows = statement
            .query_map(params![PREVIEW_CHARS as i64, pattern, limit as i64], summary)
            .map_err(|error| format!("could not read clipboard history: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("could not read clipboard history: {error}"))
    }

    pub fn clipboard_item(&self, id: &str) -> Result<Option<ClipboardItem>, String> {
        self.app_connection()?
            .query_row(
                "select id, kind, text, html, image from clipboard_items where id = ?1",
                params![id],
                |row| {
                    Ok(ClipboardItem {
                        id: row.get(0)?,
                        kind: ClipboardKind::parse(&row.get::<_, String>(1)?),
                        text: row.get(2)?,
                        html: row.get(3)?,
                        image_png: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|error| format!("could not read a copy: {error}"))
    }

    pub fn set_clipboard_pinned(&self, id: &str, pinned: bool) -> Result<(), String> {
        self.app_connection()?
            .execute("update clipboard_items set pinned = ?2 where id = ?1", params![id, pinned])
            .map_err(|error| format!("could not pin a copy: {error}"))?;
        Ok(())
    }

    pub fn forget_clipboard_item(&self, id: &str) -> Result<(), String> {
        self.app_connection()?
            .execute("delete from clipboard_items where id = ?1", params![id])
            .map_err(|error| format!("could not forget a copy: {error}"))?;
        Ok(())
    }

    /// Forget the history. Pinned entries stay unless `pinned_too`.
    pub fn clear_clipboard_history(&self, pinned_too: bool) -> Result<(), String> {
        let statement = if pinned_too {
            "delete from clipboard_items"
        } else {
            "delete from clipboard_items where pinned = 0"
        };
        self.app_connection()?
            .execute(statement, [])
            .map_err(|error| format!("could not clear clipboard history: {error}"))?;
        Ok(())
    }
}

fn summary(row: &Row<'_>) -> rusqlite::Result<ClipboardSummary> {
    Ok(ClipboardSummary {
        id: row.get(0)?,
        kind: ClipboardKind::parse(&row.get::<_, String>(1)?),
        preview: row.get(2)?,
        characters: row.get::<_, i64>(3)? as usize,
        rich: row.get(4)?,
        source_name: row.get(5)?,
        copied_at: row.get(6)?,
        pinned: row.get(7)?,
    })
}

/// `query` as a LIKE pattern that matches it literally.
fn escape_like(query: &str) -> String {
    query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
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

    fn text(value: &str) -> NewClipboardItem {
        NewClipboardItem {
            kind: ClipboardKind::Text,
            text: value.to_owned(),
            html: None,
            image_png: None,
            fingerprint: format!("text:{value}"),
            source_name: Some("Safari".to_owned()),
            source_bundle: Some("com.apple.Safari".to_owned()),
        }
    }

    fn previews(store: &MetadataStore, query: &str) -> Vec<String> {
        store.clipboard_items(query, 50).expect("list").into_iter().map(|item| item.preview).collect()
    }

    #[test]
    fn copies_come_back_newest_first_and_a_repeat_moves_to_the_top() {
        let (store, _dir) = store();
        let first = store.remember_copy(&text("first"), "a", 10).expect("keep");
        std::thread::sleep(std::time::Duration::from_millis(2));
        store.remember_copy(&text("second"), "b", 10).expect("keep");
        std::thread::sleep(std::time::Duration::from_millis(2));
        let again = store.remember_copy(&text("first"), "c", 10).expect("keep again");
        assert_eq!(again, first, "the same content keeps its entry");
        assert_eq!(previews(&store, ""), ["first", "second"]);
    }

    #[test]
    fn the_oldest_unpinned_copies_go_past_the_limit_and_pinned_ones_stay() {
        let (store, _dir) = store();
        store.remember_copy(&text("keep me"), "pinned", 2).expect("keep");
        store.set_clipboard_pinned("pinned", true).expect("pin");
        for (index, value) in ["one", "two", "three"].into_iter().enumerate() {
            std::thread::sleep(std::time::Duration::from_millis(2));
            store.remember_copy(&text(value), &format!("id{index}"), 2).expect("keep");
        }
        assert_eq!(previews(&store, ""), ["keep me", "three", "two"]);
    }

    #[test]
    fn the_history_is_searchable_and_literal() {
        let (store, _dir) = store();
        store.remember_copy(&text("100% sure"), "a", 10).expect("keep");
        store.remember_copy(&text("Tomato Soup"), "b", 10).expect("keep");
        assert_eq!(previews(&store, "tomato"), ["Tomato Soup"]);
        assert_eq!(previews(&store, "%"), ["100% sure"]);
    }

    #[test]
    fn an_entry_keeps_its_rich_version_and_image_and_can_be_forgotten() {
        let (store, _dir) = store();
        let rich = NewClipboardItem { html: Some("<b>bold</b>".to_owned()), ..text("bold") };
        store.remember_copy(&rich, "rich", 10).expect("keep");
        let image = NewClipboardItem {
            kind: ClipboardKind::Image,
            text: String::new(),
            image_png: Some(vec![137, 80, 78, 71]),
            fingerprint: "image:1".to_owned(),
            ..text("")
        };
        store.remember_copy(&image, "image", 10).expect("keep");
        let summaries = store.clipboard_items("", 10).expect("list");
        assert!(summaries.iter().any(|item| item.id == "rich" && item.rich));
        assert_eq!(store.clipboard_item("image").expect("read").and_then(|item| item.image_png), Some(vec![137, 80, 78, 71]));
        store.forget_clipboard_item("rich").expect("forget");
        assert_eq!(store.clipboard_item("rich").expect("read"), None);
    }

    #[test]
    fn clearing_keeps_pinned_entries_unless_asked() {
        let (store, _dir) = store();
        store.remember_copy(&text("pinned"), "p", 10).expect("keep");
        store.set_clipboard_pinned("p", true).expect("pin");
        store.remember_copy(&text("loose"), "l", 10).expect("keep");
        store.clear_clipboard_history(false).expect("clear");
        assert_eq!(previews(&store, ""), ["pinned"]);
        store.clear_clipboard_history(true).expect("clear all");
        assert!(previews(&store, "").is_empty());
    }
}
