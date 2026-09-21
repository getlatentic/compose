//! What a file opened in Compose is, judged by its extension: a Markdown note,
//! which Compose renders, or plain text, which it shows exactly as written.

use std::path::Path;

const PLAIN_TEXT_EXTENSIONS: [&str; 1] = ["txt"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentKind {
    Markdown,
    PlainText,
}

impl DocumentKind {
    pub fn of(path: &Path) -> Option<Self> {
        let path = path.to_str()?;
        if workspace_index::is_markdown_path(path) {
            return Some(Self::Markdown);
        }
        let extension = Path::new(path).extension()?.to_str()?;
        PLAIN_TEXT_EXTENSIONS
            .iter()
            .any(|known| extension.eq_ignore_ascii_case(known))
            .then_some(Self::PlainText)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn markdown_and_text_files_are_documents() {
        assert_eq!(DocumentKind::of(Path::new("/n/plan.md")), Some(DocumentKind::Markdown));
        assert_eq!(DocumentKind::of(Path::new("/n/plan.MKD")), Some(DocumentKind::Markdown));
        assert_eq!(DocumentKind::of(Path::new("/n/log.TXT")), Some(DocumentKind::PlainText));
        assert_eq!(DocumentKind::of(Path::new("/n/photo.png")), None);
        assert_eq!(DocumentKind::of(Path::new("/n/authorized_keys")), None);
        assert_eq!(DocumentKind::of(Path::new("/n/.txt")), None);
    }

    /// macOS offers Compose exactly the types tauri.conf.json declares, and
    /// hands them over only if Compose then accepts them.
    #[test]
    fn compose_opens_exactly_the_file_types_it_declares() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json");
        let declared: BTreeSet<String> = config["bundle"]["fileAssociations"]
            .as_array()
            .expect("fileAssociations")
            .iter()
            .flat_map(|association| association["ext"].as_array().expect("ext").clone())
            .map(|extension| extension.as_str().expect("extension").to_owned())
            .collect();
        let opened: BTreeSet<String> = workspace_index::MARKDOWN_EXTENSIONS
            .iter()
            .chain(PLAIN_TEXT_EXTENSIONS.iter())
            .map(|extension| (*extension).to_owned())
            .collect();
        assert_eq!(declared, opened);
    }
}
