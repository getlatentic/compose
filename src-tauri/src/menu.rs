//! The native menu bar.
//!
//! Built at construction rather than in `setup` so there is no default→custom
//! menu-bar flash on launch. Every item added here emits `menu://<id>`; the
//! routing lives in `lib.rs`, the behaviour in the front end.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Runtime};

/// Items this menu adds, as `(id, label, accelerator)`.
///
/// One table rather than scattered literals so a test can check every
/// accelerator actually parses. An unparseable one is not a build error and not
/// a runtime error — the item simply appears with no shortcut, which nobody
/// notices until a user reports that a key "does nothing".
const ITEMS: &[(&str, &str, &str)] = &[
    // The sidebar's New menu has advertised these two since it was built, with
    // nothing bound to them — the shortcut column was decoration. On the File
    // menu they work wherever focus is, including inside the editor.
    ("new-note", "New Note", "CmdOrCtrl+N"),
    ("new-folder", "New Folder", "CmdOrCtrl+Shift+N"),
    ("print", "Print…", "CmdOrCtrl+P"),
    ("open-file", "Open File…", "CmdOrCtrl+O"),
    ("focus-mode", "Focus Mode", "CmdOrCtrl+Shift+D"),
    ("settings", "Settings…", "CmdOrCtrl+,"),
    // The physical keys, not the printed ones: `muda` knows no bare "Plus"
    // (only the numpad variant), and ⌘+ on the common layouts is really ⌘
    // plus the `=` key. ⌘⇧= is handled in the web view, where the shifted
    // character is what actually arrives.
    ("zoom-in", "Zoom In", "CmdOrCtrl+="),
    ("zoom-out", "Zoom Out", "CmdOrCtrl+-"),
    ("zoom-reset", "Actual Size", "CmdOrCtrl+0"),
];

/// Ids whose menu event the front end listens for.
pub const MENU_EVENT_IDS: &[&str] = &[
    "new-note",
    "new-folder",
    "print",
    "open-file",
    "focus-mode",
    "settings",
    "zoom-in",
    "zoom-out",
    "zoom-reset",
];

fn item<R: Runtime>(handle: &AppHandle<R>, id: &str) -> tauri::Result<MenuItem<R>> {
    let (_, label, accel) = ITEMS
        .iter()
        .find(|(item_id, _, _)| *item_id == id)
        .expect("every id built here has a row in ITEMS");
    MenuItem::with_id(handle, id, label, true, Some(*accel))
}

/// The platform default menu plus Compose's own items.
///
/// `Menu::default` already carries the app, File and View submenus, so these go
/// *into* those rather than adding a second one — with a fallback for a
/// platform whose default menu has neither.
pub fn build<R: Runtime>(handle: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(handle)?;

    let new_note = item(handle, "new-note")?;
    let new_folder = item(handle, "new-folder")?;
    let print = item(handle, "print")?;
    let open_file = item(handle, "open-file")?;
    let focus = item(handle, "focus-mode")?;
    let settings = item(handle, "settings")?;
    let zoom_in = item(handle, "zoom-in")?;
    let zoom_out = item(handle, "zoom-out")?;
    let zoom_reset = item(handle, "zoom-reset")?;

    let mut print_added = false;
    let mut focus_added = false;
    for (index, entry) in menu.items()?.iter().enumerate() {
        let Some(submenu) = entry.as_submenu() else {
            continue;
        };
        // The app submenu is first (its title is the app name); Settings… sits
        // after About and its separator, per the macOS convention.
        if index == 0 {
            submenu.insert(&settings, 2)?;
            submenu.insert(&PredefinedMenuItem::separator(handle)?, 3)?;
            continue;
        }
        match submenu.text().as_deref() {
            Ok("File") => {
                submenu.prepend(&PredefinedMenuItem::separator(handle)?)?;
                submenu.prepend(&open_file)?;
                submenu.prepend(&PredefinedMenuItem::separator(handle)?)?;
                submenu.prepend(&new_folder)?;
                submenu.prepend(&new_note)?;
                submenu.append(&print)?;
                print_added = true;
            }
            Ok("View") => {
                submenu.prepend(&PredefinedMenuItem::separator(handle)?)?;
                submenu.prepend(&zoom_reset)?;
                submenu.prepend(&zoom_out)?;
                submenu.prepend(&zoom_in)?;
                submenu.prepend(&PredefinedMenuItem::separator(handle)?)?;
                submenu.prepend(&focus)?;
                focus_added = true;
            }
            _ => {}
        }
    }

    if !print_added {
        menu.insert(
            &Submenu::with_items(
                handle,
                "File",
                true,
                &[
                    &new_note,
                    &new_folder,
                    &PredefinedMenuItem::separator(handle)?,
                    &open_file,
                    &print,
                ],
            )?,
            1,
        )?;
    }
    if !focus_added {
        menu.append(&Submenu::with_items(
            handle,
            "View",
            true,
            &[
                &focus,
                &PredefinedMenuItem::separator(handle)?,
                &zoom_in,
                &zoom_out,
                &zoom_reset,
            ],
        )?)?;
    }
    Ok(menu)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A menu item with an unparseable accelerator is built happily and simply
    /// has no shortcut — no error at build time, none at run time, and nothing
    /// visible until someone presses the key and nothing happens. `muda` is the
    /// parser Tauri hands these strings to, so parsing every row against it
    /// here is the only place that failure can be caught automatically.
    ///
    /// It has caught the obvious trap already: `"CmdOrCtrl+Plus"` does not
    /// parse — `muda` knows only `NumpadPlus` — so Zoom In uses `=`.
    #[test]
    fn every_accelerator_parses() {
        for (id, _, accel) in ITEMS {
            assert!(
                accel.parse::<muda::accelerator::Accelerator>().is_ok(),
                "{id}: {accel:?} is not an accelerator muda can parse",
            );
        }
    }

    #[test]
    fn the_plus_spelling_that_looks_right_is_the_one_that_fails() {
        // Guards the comment on ITEMS: if a future muda learns "Plus", this
        // fails and the workaround can go.
        assert!("CmdOrCtrl+Plus".parse::<muda::accelerator::Accelerator>().is_err());
    }

    #[test]
    fn every_built_item_is_routed() {
        for (id, _, _) in ITEMS {
            assert!(
                MENU_EVENT_IDS.contains(id),
                "{id} is in the menu but its event is never routed",
            );
        }
    }

    #[test]
    fn every_routed_id_is_built() {
        for id in MENU_EVENT_IDS {
            assert!(
                ITEMS.iter().any(|(item_id, _, _)| item_id == id),
                "{id} is routed but no menu item emits it",
            );
        }
    }
}
