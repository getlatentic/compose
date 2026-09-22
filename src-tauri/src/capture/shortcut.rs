//! The global shortcuts that open the quick-note window: one on the notes, one
//! on the clipboard history. Stored in the app's settings, and registered with
//! the system at launch and whenever one changes.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

use crate::db::MetadataStore;

/// Which part of the window a shortcut opens.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum View {
    Notes,
    Clipboard,
}

impl View {
    const ALL: [View; 2] = [View::Notes, View::Clipboard];

    fn setting_key(self) -> &'static str {
        match self {
            Self::Notes => "capture.shortcut",
            Self::Clipboard => "capture.clipboardShortcut",
        }
    }

    /// ⌃⌥N and ⌃⌥V. Clear of macOS's own shortcuts — ⌃Space switches input
    /// sources, ⌥⌘Space opens a Finder search — and of the ⌥Space launchers take.
    pub(super) fn default_shortcut(self) -> &'static str {
        match self {
            Self::Notes => "Control+Alt+KeyN",
            Self::Clipboard => "Control+Alt+KeyV",
        }
    }
}

/// The shortcuts registered now, to tell which one was pressed.
#[derive(Default)]
pub struct RegisteredShortcuts(Mutex<Vec<(Shortcut, View)>>);

impl RegisteredShortcuts {
    pub(super) fn view_for(&self, pressed: &Shortcut) -> Option<View> {
        let registered = self.0.lock().ok()?;
        registered.iter().find(|(shortcut, _)| shortcut == pressed).map(|(_, view)| *view)
    }
}

/// The shortcut the user chose for `view`: the default until they choose,
/// `None` once they turn it off.
pub(super) fn chosen(metadata: &MetadataStore, view: View) -> Result<Option<String>, String> {
    Ok(metadata
        .app_setting::<Option<String>>(view.setting_key())?
        .unwrap_or_else(|| Some(view.default_shortcut().to_owned())))
}

pub(super) fn save(metadata: &MetadataStore, view: View, shortcut: Option<&str>) -> Result<(), String> {
    metadata.set_app_setting(view.setting_key(), &shortcut)
}

/// Every view's chosen shortcut, as stored.
pub(super) fn all_chosen(metadata: &MetadataStore) -> Result<Vec<(View, Option<String>)>, String> {
    View::ALL.into_iter().map(|view| Ok((view, chosen(metadata, view)?))).collect()
}

/// Make `shortcuts` the ones that open the window, replacing whatever did. macOS
/// accepts keys another app has registered too, so a clash with another app is
/// not reported here; the same keys for both views are refused.
pub(super) fn register(app: &AppHandle, shortcuts: &[(View, Option<String>)]) -> Result<(), String> {
    let parsed: Vec<(Shortcut, View, &str)> = shortcuts
        .iter()
        .filter_map(|(view, text)| text.as_deref().map(|text| parse(text).map(|shortcut| (shortcut, *view, text))))
        .collect::<Result<_, _>>()?;
    if let [(first, _, text), (second, _, _)] = parsed.as_slice() {
        if first == second {
            return Err(format!("{text} already opens the other part of the quick-note window."));
        }
    }
    let global = app.global_shortcut();
    global
        .unregister_all()
        .map_err(|error| format!("could not release the quick-note shortcuts: {error}"))?;
    for (shortcut, _, text) in &parsed {
        global
            .register(*shortcut)
            .map_err(|error| format!("{text} could not be registered ({error})"))?;
    }
    if let Ok(mut registered) = app.state::<RegisteredShortcuts>().0.lock() {
        *registered = parsed.into_iter().map(|(shortcut, view, _)| (shortcut, view)).collect();
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
    fn the_defaults_are_real_shortcuts() {
        for view in View::ALL {
            assert!(parse(view.default_shortcut()).is_ok(), "{view:?}");
        }
    }

    #[test]
    fn nonsense_is_refused_before_anything_is_registered() {
        assert!(parse("Control+Wobble").is_err());
    }

    #[test]
    fn each_view_opens_with_its_default_until_the_user_chooses() {
        let (store, _dir) = store();
        assert_eq!(chosen(&store, View::Notes).unwrap().as_deref(), Some("Control+Alt+KeyN"));
        assert_eq!(chosen(&store, View::Clipboard).unwrap().as_deref(), Some("Control+Alt+KeyV"));

        save(&store, View::Clipboard, Some("Super+Shift+KeyV")).unwrap();
        save(&store, View::Notes, None).unwrap();
        assert_eq!(chosen(&store, View::Clipboard).unwrap().as_deref(), Some("Super+Shift+KeyV"));
        assert_eq!(chosen(&store, View::Notes).unwrap(), None, "turned off stays off");
    }

    #[test]
    fn the_notes_shortcut_keeps_its_old_setting_key() {
        assert_eq!(View::Notes.setting_key(), "capture.shortcut", "a shortcut chosen before clipboard history still counts");
    }
}
