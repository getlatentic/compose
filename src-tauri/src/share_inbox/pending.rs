//! What the inbox commands hand the frontend, and what it hands back.

use serde::Serialize;

use super::inbox::StoredClip;

/// What the frontend needs to convert a clip: its id and shared content.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingClip {
    pub id: String,
    /// What a page's relative links resolve against.
    pub url: Option<String>,
    pub html: Option<String>,
    pub text: Option<String>,
    pub page: Option<String>,
    pub markdown: Option<String>,
}

impl From<StoredClip> for PendingClip {
    fn from(stored: StoredClip) -> Self {
        Self {
            id: stored.id,
            url: stored.clip.url,
            html: stored.clip.html,
            text: stored.clip.text,
            page: stored.clip.page,
            markdown: stored.clip.markdown,
        }
    }
}

/// Where a clip was filed, and whether the user asked to see it.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedClip {
    pub workspace_id: String,
    pub relative_path: String,
    pub open: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_group::contract::Clip;

    const CLIP_FIXTURE: &str = include_str!("../../extensions/shared/Fixtures/clip.json");
    const BROWSER_CLIP_FIXTURE: &str = include_str!("../../extensions/shared/Fixtures/browser-clip.json");

    #[test]
    fn a_pending_clip_hands_the_frontend_the_page_and_its_address() {
        let clip: Clip = serde_json::from_str(CLIP_FIXTURE).expect("fixture decodes");
        let pending = serde_json::to_value(PendingClip::from(StoredClip {
            id: "c1".to_owned(),
            clip,
        }))
        .expect("serializes");

        assert_eq!(pending["url"], "https://www.latentic.ai/blog/proof-of-code-understanding");
        assert!(pending["page"].as_str().is_some_and(|page| page.contains("<article>")));
    }

    #[test]
    fn a_browser_clip_hands_the_frontend_its_markdown() {
        let clip: Clip = serde_json::from_str(BROWSER_CLIP_FIXTURE).expect("fixture decodes");
        assert_eq!(clip.page, None);
        let pending = PendingClip::from(StoredClip { id: clip.id.clone(), clip });
        assert!(pending.markdown.as_deref().is_some_and(|markdown| markdown.contains("```")));
        assert_eq!(pending.url.as_deref(), Some("https://www.latentic.ai/blog/a-clipped-article"));
    }
}
