//! The global shortcut that opens the capture window: stored in the app's
//! settings, and registered with the system at launch and whenever it changes.

use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::db::MetadataStore;

const SETTING_KEY: &str = "capture.shortcut";

/// ⌃⌥N. Clear of macOS's own shortcuts — ⌃Space switches input sources, ⌥⌘Space
/// opens a Finder search — and of the ⌥Space that launchers tend to take.
pub(super) const DEFAULT_SHORTCUT: &str = "Control+Alt+KeyN";

/// The shortcut the user chose: the default until they choose, `None` once they
/// turn it off.
pub(super) fn chosen(metadata: &MetadataStore) -> Result<Option<String>, String> {
    Ok(metadata
        .app_setting::<Option<String>>(SETTING_KEY)?
        .unwrap_or_else(|| Some(DEFAULT_SHORTCUT.to_owned())))
}

pub(super) fn save(metadata: &MetadataStore, shortcut: Option<&str>) -> Result<(), String> {
    metadata.set_app_setting(SETTING_KEY, &shortcut)
}

/// Make `shortcut` the one that opens capture, replacing whatever did. The
/// system refuses a combination another app already holds.
pub(super) fn register(app: &AppHandle, shortcut: Option<&str>) -> Result<(), String> {
    let parsed = shortcut.map(parse).transpose()?;
    let shortcuts = app.global_shortcut();
    shortcuts
        .unregister_all()
        .map_err(|error| format!("could not release the capture shortcut: {error}"))?;
    if let (Some(text), Some(parsed)) = (shortcut, parsed) {
        shortcuts.register(parsed).map_err(|error| {
            format!("{text} could not be registered; another app may be using it ({error})")
        })?;
    }
    Ok(())
}

fn parse(shortcut: &str) -> Result<Shortcut, String> {
    shortcut
        .parse()
        .map_err(|error| format!("{shortcut} is not a shortcut: {error}"))
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
    fn the_default_is_a_real_shortcut() {
        assert!(parse(DEFAULT_SHORTCUT).is_ok());
    }

    #[test]
    fn nonsense_is_refused_before_anything_is_registered() {
        assert!(parse("Control+Wobble").is_err());
    }

    #[test]
    fn capture_opens_with_the_default_until_the_user_chooses() {
        let (store, _dir) = store();
        assert_eq!(chosen(&store).unwrap().as_deref(), Some(DEFAULT_SHORTCUT));

        save(&store, Some("Super+Shift+KeyI")).unwrap();
        assert_eq!(chosen(&store).unwrap().as_deref(), Some("Super+Shift+KeyI"));

        save(&store, None).unwrap();
        assert_eq!(chosen(&store).unwrap(), None, "turned off stays off");
    }
}
