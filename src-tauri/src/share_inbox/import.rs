//! Filing a clip: where it goes, its images, the note, and then the clip gone.

use super::contract::{Clip, ImportedClip};
use super::inbox::Inbox;
use super::note;
use crate::db::MetadataStore;
use crate::files::{create_file, ensure_vault_metadata, write_binary_file, FileError};
use crate::workspace::{WorkspaceList, WorkspaceRegistry};

/// Past this many same-named files a collision is a bug, not bad luck.
const MAX_NAME_ATTEMPTS: usize = 1000;
/// Beside the note, where a pasted image goes too.
const IMAGE_DIR: &str = "images";

/// File one clip as a note. `Ok(None)` when there is nothing to do yet: the clip
/// was already filed, or there is no workspace to file it in.
///
/// The note is written before the clip is removed, so an interrupted import
/// files a clip twice rather than losing it.
pub(super) fn import_clip(
    inbox: &Inbox,
    clip_id: &str,
    markdown: &str,
    registry: &WorkspaceRegistry,
    metadata: &MetadataStore,
) -> Result<Option<ImportedClip>, FileError> {
    let Some(clip) = inbox.read(clip_id)? else {
        return Ok(None);
    };
    let Some(workspace_id) = destination(&clip, &registry.list()?) else {
        return Ok(None);
    };
    let root = registry.workspace_root(&workspace_id)?;
    ensure_vault_metadata(metadata, &workspace_id, &root)?;

    let images = copy_images(inbox, clip_id, &clip, registry, &workspace_id)?;
    let content = note::compose(&clip.title, clip.url.as_deref(), markdown, &images);
    let (relative_path, last_modified_ms) =
        create_note(registry, &workspace_id, &clip.title, &content)?;
    metadata.record_document_written(
        &workspace_id,
        &relative_path,
        &content,
        last_modified_ms,
        content.len() as u64,
    )?;
    inbox.remove(clip_id)?;
    Ok(Some(ImportedClip {
        workspace_id,
        relative_path,
    }))
}

/// The workspace chosen in the sheet while it still exists, else the one open
/// now, else any.
fn destination(clip: &Clip, list: &WorkspaceList) -> Option<String> {
    let registered = |id: &&str| list.workspaces.iter().any(|workspace| workspace.id == *id);
    clip.workspace_id
        .as_deref()
        .filter(registered)
        .or_else(|| list.active_workspace_id.as_deref().filter(registered))
        .or_else(|| list.workspaces.first().map(|workspace| workspace.id.as_str()))
        .map(str::to_owned)
}

fn copy_images(
    inbox: &Inbox,
    clip_id: &str,
    clip: &Clip,
    registry: &WorkspaceRegistry,
    workspace_id: &str,
) -> Result<Vec<String>, FileError> {
    let mut placed = Vec::new();
    for name in &clip.images {
        let Some(bytes) = inbox.image(clip_id, name) else {
            eprintln!("share clip {clip_id}: image {name} is missing, filing the note without it");
            continue;
        };
        let relative_path = free_image_path(registry, workspace_id, name)?;
        write_binary_file(registry, workspace_id, &relative_path, &bytes)?;
        placed.push(relative_path);
    }
    Ok(placed)
}

fn free_image_path(
    registry: &WorkspaceRegistry,
    workspace_id: &str,
    name: &str,
) -> Result<String, FileError> {
    let (stem, extension) = name
        .rsplit_once('.')
        .map_or((name, None), |(stem, extension)| (stem, Some(extension)));
    for attempt in 1..=MAX_NAME_ATTEMPTS {
        let suffix = if attempt == 1 { String::new() } else { format!("-{attempt}") };
        let file = match extension {
            Some(extension) => format!("{stem}{suffix}.{extension}"),
            None => format!("{stem}{suffix}"),
        };
        let relative_path = format!("{IMAGE_DIR}/{file}");
        if !registry.resolve_workspace_path(workspace_id, &relative_path)?.exists() {
            return Ok(relative_path);
        }
    }
    Err(format!("no free name for image {name}").into())
}

fn create_note(
    registry: &WorkspaceRegistry,
    workspace_id: &str,
    title: &str,
    content: &str,
) -> Result<(String, i64), FileError> {
    let stem = note::file_stem(title);
    for attempt in 1..=MAX_NAME_ATTEMPTS {
        let relative_path = note::candidate(&stem, attempt);
        match create_file(registry, workspace_id, &relative_path, content) {
            Ok(written) => return Ok((relative_path, written.last_modified_ms)),
            Err(FileError::AlreadyExists { .. }) => continue,
            Err(error) => return Err(error),
        }
    }
    Err(format!("no free name for a note titled {title}").into())
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;

    use super::*;

    struct Fixture {
        registry: WorkspaceRegistry,
        metadata: MetadataStore,
        inbox: Inbox,
        vault: PathBuf,
        workspace_id: String,
        _dirs: Vec<tempfile::TempDir>,
    }

    fn fixture() -> Fixture {
        let [config, data, vault, share] = [(); 4].map(|()| tempfile::tempdir().expect("dir"));
        let registry = WorkspaceRegistry::default();
        registry.init_from_dir(config.path()).expect("registry");
        let list = registry
            .add(vault.path().to_string_lossy().into_owned())
            .expect("workspace");
        let metadata = MetadataStore::default();
        metadata.init_from_dir(data.path()).expect("metadata");
        Fixture {
            workspace_id: list.workspaces[0].id.clone(),
            inbox: Inbox::new(share.path().to_path_buf()),
            vault: vault.path().to_path_buf(),
            registry,
            metadata,
            _dirs: vec![config, data, vault, share],
        }
    }

    fn leave(fixture: &Fixture, id: &str, clip: serde_json::Value, images: &[(&str, &[u8])]) {
        let dir = fixture.inbox.inbox_dir().join(id);
        fs::create_dir_all(&dir).expect("clip dir");
        fs::write(dir.join("clip.json"), clip.to_string()).expect("clip.json");
        for (name, bytes) in images {
            fs::write(dir.join(name), bytes).expect("image");
        }
    }

    fn file(fixture: &Fixture, id: &str, markdown: &str) -> Option<ImportedClip> {
        import_clip(&fixture.inbox, id, markdown, &fixture.registry, &fixture.metadata)
            .expect("import")
    }

    #[test]
    fn a_web_clip_becomes_a_note_with_its_source_and_images() {
        let fixture = fixture();
        leave(
            &fixture,
            "c1",
            serde_json::json!({
                "version": 1, "id": "c1", "createdAt": 1, "workspaceId": fixture.workspace_id,
                "title": "Proof of Code: Understanding", "url": "https://x.dev/p",
                "images": ["1-shot.png"],
            }),
            &[("1-shot.png", &[1, 2, 3])],
        );

        let filed = file(&fixture, "c1", "Body **bold**.").expect("filed");

        assert_eq!(filed.relative_path, "Proof of Code Understanding.md");
        assert_eq!(
            fs::read_to_string(fixture.vault.join(&filed.relative_path)).expect("note"),
            "---\nsource: \"https://x.dev/p\"\n---\n\n# Proof of Code: Understanding\n\n\
             Body **bold**.\n\n![shot](images/1-shot.png)\n"
        );
        assert_eq!(fs::read(fixture.vault.join("images/1-shot.png")).expect("image"), [1, 2, 3]);
        assert!(!fixture.inbox.inbox_dir().join("c1").exists(), "the clip is gone once filed");
    }

    #[test]
    fn a_clip_already_filed_is_not_filed_again() {
        let fixture = fixture();
        leave(&fixture, "c1", serde_json::json!({"version": 1, "id": "c1", "createdAt": 1, "title": "Once"}), &[]);
        assert!(file(&fixture, "c1", "").is_some());
        assert_eq!(file(&fixture, "c1", ""), None);
        assert!(!fixture.vault.join("Once 2.md").exists());
    }

    #[test]
    fn a_title_already_taken_gets_the_next_number() {
        let fixture = fixture();
        fs::write(fixture.vault.join("Note.md"), "mine").expect("existing note");
        leave(&fixture, "c1", serde_json::json!({"version": 1, "id": "c1", "createdAt": 1, "title": "Note"}), &[]);
        assert_eq!(file(&fixture, "c1", "").expect("filed").relative_path, "Note 2.md");
        assert_eq!(fs::read_to_string(fixture.vault.join("Note.md")).expect("note"), "mine");
    }

    #[test]
    fn an_image_name_already_taken_is_not_overwritten() {
        let fixture = fixture();
        fs::create_dir_all(fixture.vault.join("images")).expect("images");
        fs::write(fixture.vault.join("images/1-shot.png"), b"mine").expect("existing image");
        leave(
            &fixture,
            "c1",
            serde_json::json!({"version": 1, "id": "c1", "createdAt": 1, "title": "T", "images": ["1-shot.png"]}),
            &[("1-shot.png", b"shared")],
        );
        let filed = file(&fixture, "c1", "").expect("filed");
        let note = fs::read_to_string(fixture.vault.join(filed.relative_path)).expect("note");
        assert!(note.contains("(images/1-shot-2.png)"), "{note}");
        assert_eq!(fs::read(fixture.vault.join("images/1-shot.png")).expect("mine"), b"mine");
    }

    #[test]
    fn a_workspace_removed_since_sharing_falls_back_to_the_open_one() {
        let fixture = fixture();
        leave(
            &fixture,
            "c1",
            serde_json::json!({"version": 1, "id": "c1", "createdAt": 1, "title": "T", "workspaceId": "removed"}),
            &[],
        );
        assert_eq!(file(&fixture, "c1", "").expect("filed").workspace_id, fixture.workspace_id);
    }

    #[test]
    fn with_no_workspace_to_file_into_the_clip_waits() {
        let fixture = fixture();
        fixture.registry.remove(fixture.workspace_id.clone()).expect("remove");
        leave(&fixture, "c1", serde_json::json!({"version": 1, "id": "c1", "createdAt": 1, "title": "T"}), &[]);
        assert_eq!(file(&fixture, "c1", ""), None);
        assert_eq!(fixture.inbox.pending().expect("pending").len(), 1);
    }
}
