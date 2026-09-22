//! The main window. Made at launch — unless macOS opened Compose at login, when
//! it starts with only the quick note — and made again whenever the user comes
//! back to a Compose without one: its Dock icon, or a note opened from the
//! Finder, Spotlight, a link or a Service. Closing it leaves Compose running, so
//! the quick note's shortcuts keep working.

use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder};

use crate::{boot_payload, launch_window, profile_migration};

pub const LABEL: &str = "main";

/// Make the main window at launch, with the boot data read before the runtime
/// started.
pub fn open_at_launch(app: &AppHandle, boot_script: String) {
    if let Err(error) = build(app, boot_script) {
        eprintln!("main window: {error}");
    }
}

/// Bring the main window forward, making it again if the user closed it. One
/// still on its way up is left to its launch, which shows it once drawn.
pub fn ensure(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        if launch_window::shown() {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
        return;
    }
    let app = app.clone();
    // Its boot data is read afresh — the one read at launch is hours old by now —
    // and off the main thread, as the vault may be a cold iCloud folder.
    std::thread::spawn(move || {
        let boot_script = boot_payload::init_script(profile_migration::profile_dir());
        if let Err(error) = build(&app, boot_script) {
            eprintln!("main window: {error}");
        }
    });
}

fn build(app: &AppHandle, boot_script: String) -> tauri::Result<WebviewWindow> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == LABEL)
        .cloned()
        .ok_or(tauri::Error::WindowNotFound)?;
    let window = WebviewWindowBuilder::from_config(app, &config)?
        .initialization_script(boot_script)
        .build()?;
    // The window paints its configured background before the web view has
    // anything to show; configured white, that is a white flash for a dark-mode
    // user. The OS appearance is the best answer this early — a stored "always
    // light" is not readable before the front end runs — and the splash corrects it.
    if window.theme().is_ok_and(|theme| theme == tauri::Theme::Dark) {
        let _ = window.set_background_color(Some(tauri::window::Color(0x16, 0x16, 0x16, 0xff)));
    }
    crate::boot_native_mark("pre-focus");
    // Hidden until drawn: `launch_window` shows it, or its deadline does.
    launch_window::arm_deadline(app.clone());
    // Safari's Web Inspector opens with it in a build made with
    // `COMPOSE_DEVTOOLS=1`; `option_env!` keeps a release build from ever doing so.
    if cfg!(debug_assertions) || option_env!("COMPOSE_DEVTOOLS").is_some() {
        window.open_devtools();
    }
    Ok(window)
}
