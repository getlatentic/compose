//! The files the app and its extensions exchange. Each type mirrors one in
//! `extensions/shared/Contract.swift`, and both sides' tests read the same
//! fixtures in `extensions/shared/Fixtures`, so neither can drift alone.

use serde::{Deserialize, Serialize};

use crate::workspace::WorkspaceList;

pub const CONTRACT_VERSION: u32 = 1;

/// The workspaces the share sheet may offer, and which one is open.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Destinations {
    pub version: u32,
    pub active_workspace_id: Option<String>,
    pub workspaces: Vec<DestinationWorkspace>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DestinationWorkspace {
    pub id: String,
    pub name: String,
}

impl Destinations {
    pub fn from_list(list: &WorkspaceList) -> Self {
        Self {
            version: CONTRACT_VERSION,
            active_workspace_id: list.active_workspace_id.clone(),
            workspaces: list
                .workspaces
                .iter()
                .map(|workspace| DestinationWorkspace {
                    id: workspace.id.clone(),
                    name: workspace.name.clone(),
                })
                .collect(),
        }
    }
}

/// One clip the extension left in the inbox.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub version: u32,
    pub id: String,
    pub created_at: i64,
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub title: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub html: Option<String>,
    /// A whole web page shared from Safari; the frontend files its article.
    #[serde(default)]
    pub page: Option<String>,
    /// Markdown the browser clipper already made from the page.
    #[serde(default)]
    pub markdown: Option<String>,
    #[serde(default)]
    pub images: Vec<String>,
    /// The user asked to see the note: the app opens it once filed.
    #[serde(default)]
    pub open: bool,
}

/// The notes changed most recently across every workspace, newest first, for
/// Shortcuts' Open Note and the widget.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NotesIndex {
    pub version: u32,
    pub notes: Vec<PublishedNote>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishedNote {
    /// Absolute, and what `compose://open?path=` opens.
    pub path: String,
    pub title: String,
    pub workspace_id: String,
    pub workspace_name: String,
    /// Milliseconds since the epoch.
    pub modified_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::WorkspaceRecord;

    const CLIP_FIXTURE: &str = include_str!("../../extensions/shared/Fixtures/clip.json");
    const DESTINATIONS_FIXTURE: &str =
        include_str!("../../extensions/shared/Fixtures/destinations.json");
    const NOTES_FIXTURE: &str = include_str!("../../extensions/shared/Fixtures/notes.json");

    #[test]
    fn decodes_the_clip_the_extension_writes() {
        let clip: Clip = serde_json::from_str(CLIP_FIXTURE).expect("fixture decodes");
        assert_eq!(clip.version, 1);
        assert_eq!(clip.title, "Proof of Code Understanding");
        assert_eq!(clip.created_at, 1_789_500_000_000);
        assert_eq!(clip.images, ["1-shot.png"]);
        assert_eq!(clip.html, None, "an absent key is a missing value");
        assert!(clip.page.as_deref().is_some_and(|page| page.contains("<article>")));
        assert!(clip.workspace_id.is_some());
        assert!(clip.open, "Open in Compose was asked for");
    }

    #[test]
    fn a_clip_with_only_its_required_keys_decodes() {
        let clip: Clip =
            serde_json::from_str(r#"{"version":1,"id":"a","createdAt":0,"title":"t"}"#)
                .expect("decodes");
        assert!(clip.images.is_empty() && clip.url.is_none() && clip.workspace_id.is_none());
        assert!(!clip.open, "a clip is filed without opening unless asked");
    }

    #[test]
    fn destinations_are_written_as_the_extension_reads_them() {
        let record = |id: &str, name: &str| WorkspaceRecord {
            id: id.to_owned(),
            name: name.to_owned(),
            path: format!("/vaults/{name}"),
            tabs: None,
            last_opened_at: Some(1),
        };
        let list = WorkspaceList {
            active_workspace_id: Some("5b8f0d2e-1c4a-4f6b-9e3d-7a2c8b1f0e4d".to_owned()),
            onboarding: Default::default(),
            workspaces: vec![
                record("5b8f0d2e-1c4a-4f6b-9e3d-7a2c8b1f0e4d", "My Notes"),
                record("0a9e8d7c-6b5a-4f3e-2d1c-0b9a8f7e6d5c", "Thesis"),
            ],
        };
        let written = serde_json::to_value(Destinations::from_list(&list)).expect("encodes");
        let fixture: serde_json::Value =
            serde_json::from_str(DESTINATIONS_FIXTURE).expect("fixture parses");
        assert_eq!(written, fixture, "paths and history stay in the app");
    }

    #[test]
    fn notes_are_written_as_the_extensions_read_them() {
        let index = NotesIndex {
            version: CONTRACT_VERSION,
            notes: vec![PublishedNote {
                path: "/Users/me/My Notes/Ideas/Launch plan.md".to_owned(),
                title: "Launch plan".to_owned(),
                workspace_id: "5b8f0d2e-1c4a-4f6b-9e3d-7a2c8b1f0e4d".to_owned(),
                workspace_name: "My Notes".to_owned(),
                modified_at: 1_789_500_000_000,
            }],
        };
        let fixture: serde_json::Value = serde_json::from_str(NOTES_FIXTURE).expect("fixture parses");
        assert_eq!(serde_json::to_value(&index).expect("encodes"), fixture);
    }
}
