//! `compose://` links.
//!
//! A link is reachable from anywhere — a web page can navigate to one, and the
//! OS will hand it to this app without a prompt. So a link says *which note to
//! open*, and only a note the user has already opened a workspace around: the
//! path is resolved against the registered roots and anything outside them is
//! refused. Without that, a page could make the app display `~/.ssh/id_rsa`,
//! and everything the app can then read, the assistant can read too.
//!
//! ```text
//! compose://open?path=/Users/me/Notes/thesis/framework.md
//! ```
//!
//! An absolute path rather than a workspace id + relative pair, because the
//! path is what another tool already has — Obsidian, Shortcuts, a shell script.
//! The scoping is enforced here rather than asked of the caller.

use std::path::{Path, PathBuf};

use tauri::Url;

pub const SCHEME: &str = "compose";

/// A link that has been parsed but NOT yet authorised.
#[derive(Debug, PartialEq, Eq)]
pub enum Request {
    Open { path: String },
}

/// The link's intent, or `None` for anything this app does not offer. Unknown
/// actions are dropped rather than guessed at: a link is untrusted input.
pub fn parse(url: &Url) -> Option<Request> {
    if url.scheme() != SCHEME {
        return None;
    }
    // `compose://open?...` parses with "open" as the HOST, not the path.
    let action = url.host_str().filter(|host| !host.is_empty())?;
    if action != "open" {
        return None;
    }
    let path = url
        .query_pairs()
        .find(|(key, _)| key == "path")
        .map(|(_, value)| value.into_owned())
        .filter(|value| !value.is_empty())?;
    Some(Request::Open { path })
}

/// The path a link may open: inside one of the registered workspaces, or
/// nothing. Symlinks and `..` are resolved before the check, so neither can
/// walk out of a root.
pub fn authorised_path(workspaces: &[(String, PathBuf)], request: &Request) -> Option<String> {
    let Request::Open { path } = request;
    match crate::external::resolve_target(workspaces, Path::new(path)) {
        crate::external::OpenTarget::Workspace { .. } => Some(path.clone()),
        // A folder would become a workspace, whose files the assistant can read,
        // and a link reaches the app from any web page.
        crate::external::OpenTarget::External { .. } | crate::external::OpenTarget::Folder { .. } => None,
    }
}

/// The note a `compose://` link may open, or `None` when the link asks for
/// something this app does not offer or for a file outside every workspace.
pub fn open_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>, url: &Url) -> Option<String> {
    use tauri::Manager;

    let request = parse(url)?;
    let roots = app
        .state::<crate::workspace::WorkspaceRegistry>()
        .list()
        .ok()?
        .workspaces
        .into_iter()
        .map(|record| (record.id, PathBuf::from(record.path)))
        .collect::<Vec<_>>();
    authorised_path(&roots, &request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn url(raw: &str) -> Url {
        Url::parse(raw).expect("url")
    }

    #[test]
    fn a_link_names_the_note_to_open() {
        assert_eq!(
            parse(&url("compose://open?path=/vault/note.md")),
            Some(Request::Open {
                path: "/vault/note.md".to_owned()
            })
        );
    }

    #[test]
    fn a_percent_encoded_path_survives() {
        assert_eq!(
            parse(&url("compose://open?path=%2Fvault%2FMSC%20Thesis%2Fa.md")),
            Some(Request::Open {
                path: "/vault/MSC Thesis/a.md".to_owned()
            })
        );
    }

    /// As the extensions write it (`OpenInCompose.link(toNoteAt:)`): a name with
    /// `&`, `+` or `=` keeps them.
    #[test]
    fn a_link_from_an_extension_keeps_every_character_of_the_name() {
        assert_eq!(
            parse(&url("compose://open?path=/Users/me/My%20Notes/A%26B%2BC%3D%C3%A9.md")),
            Some(Request::Open {
                path: "/Users/me/My Notes/A&B+C=é.md".to_owned()
            })
        );
    }

    #[test]
    fn anything_this_app_does_not_offer_is_dropped() {
        assert_eq!(parse(&url("compose://run?cmd=rm")), None);
        assert_eq!(parse(&url("compose://open")), None, "no path");
        assert_eq!(parse(&url("compose://open?path=")), None, "empty path");
        assert_eq!(parse(&url("file:///vault/note.md")), None, "other scheme");
    }

    /// The positive arm. A rule that refused everything would satisfy every
    /// "cannot reach outside" case below while making the feature do nothing.
    #[test]
    fn a_note_inside_a_workspace_is_opened() {
        let vault = tempdir().expect("dir");
        std::fs::write(vault.path().join("note.md"), "# hi").expect("write");
        let roots = vec![("w1".to_owned(), vault.path().to_path_buf())];
        let target = vault.path().join("note.md").to_string_lossy().into_owned();

        assert_eq!(
            authorised_path(&roots, &Request::Open { path: target.clone() }),
            Some(target)
        );
    }

    #[test]
    fn a_path_outside_every_workspace_is_refused() {
        let vault = tempdir().expect("vault");
        let elsewhere = tempdir().expect("elsewhere");
        std::fs::write(elsewhere.path().join("secret"), "x").expect("write");
        let roots = vec![("w1".to_owned(), vault.path().to_path_buf())];

        assert_eq!(
            authorised_path(
                &roots,
                &Request::Open {
                    path: elsewhere.path().join("secret").to_string_lossy().into_owned()
                }
            ),
            None
        );
    }

    #[test]
    fn a_link_cannot_make_a_folder_a_workspace() {
        let vault = tempdir().expect("vault");
        let elsewhere = tempdir().expect("elsewhere");
        let roots = vec![("w1".to_owned(), vault.path().to_path_buf())];
        let as_link = |path: &Path| Request::Open { path: path.to_string_lossy().into_owned() };

        assert_eq!(authorised_path(&roots, &as_link(elsewhere.path())), None);
        assert_eq!(authorised_path(&roots, &as_link(vault.path())), None, "not even a workspace's own root");
    }

    #[test]
    fn a_traversal_out_of_a_workspace_is_refused() {
        let parent = tempdir().expect("parent");
        let vault = parent.path().join("vault");
        std::fs::create_dir(&vault).expect("vault");
        std::fs::write(parent.path().join("outside.md"), "x").expect("write");
        let roots = vec![("w1".to_owned(), vault.clone())];

        assert_eq!(
            authorised_path(
                &roots,
                &Request::Open {
                    path: vault.join("../outside.md").to_string_lossy().into_owned()
                }
            ),
            None,
            "`..` is resolved before the root check, so it cannot climb out"
        );
    }
}
