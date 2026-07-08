//! "Make Compose the default Markdown editor" (#113): reads and sets the
//! LaunchServices default-role handler for the Markdown content type.

use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownHandlerStatus {
    pub is_default: bool,
    pub current_handler: Option<String>,
}

#[cfg(target_os = "macos")]
mod macos {
    use objc2_core_foundation::{CFRetained, CFString};
    use std::ptr::NonNull;

    /// The de-facto UTI for Markdown documents (declared by CoreTypes).
    const MARKDOWN_UTI: &str = "net.daring-fireball.markdown";
    const K_LS_ROLES_ALL: u32 = 0xFFFF_FFFF;

    // Deprecated since 12.0 in favor of NSWorkspace's async API, but still
    // present and synchronous — the right size for a settings toggle.
    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSCopyDefaultRoleHandlerForContentType(
            content_type: &CFString,
            role: u32,
        ) -> *mut CFString;
        fn LSSetDefaultRoleHandlerForContentType(
            content_type: &CFString,
            role: u32,
            handler_bundle_id: &CFString,
        ) -> i32;
    }

    pub fn current_handler() -> Option<String> {
        let uti = CFString::from_str(MARKDOWN_UTI);
        let raw = unsafe { LSCopyDefaultRoleHandlerForContentType(&uti, K_LS_ROLES_ALL) };
        let retained = NonNull::new(raw).map(|ptr| unsafe { CFRetained::from_raw(ptr) })?;
        Some(retained.to_string())
    }

    pub fn set_handler(bundle_id: &str) -> Result<(), String> {
        let uti = CFString::from_str(MARKDOWN_UTI);
        let handler = CFString::from_str(bundle_id);
        let status =
            unsafe { LSSetDefaultRoleHandlerForContentType(&uti, K_LS_ROLES_ALL, &handler) };
        if status == 0 {
            return Ok(());
        }
        // -10814 = app unknown to LaunchServices (e.g. an unbundled dev build).
        Err(format!(
            "LaunchServices could not set the default app (OSStatus {status}). \
             In Finder: Get Info on a .md file → Open with → Compose → Change All."
        ))
    }
}

// `(async)` keeps the LaunchServices database round-trips off the main
// thread — a cold LS cache can take long enough to stall the event loop.
#[tauri::command(async)]
pub fn markdown_handler_status(app: AppHandle) -> Result<MarkdownHandlerStatus, String> {
    #[cfg(target_os = "macos")]
    {
        let ours = app.config().identifier.clone();
        let current = macos::current_handler();
        Ok(MarkdownHandlerStatus {
            is_default: current
                .as_deref()
                .is_some_and(|handler| handler.eq_ignore_ascii_case(&ours)),
            current_handler: current,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("the default Markdown app is only managed on macOS".to_owned())
    }
}

#[tauri::command(async)]
pub fn set_default_markdown_handler(app: AppHandle) -> Result<MarkdownHandlerStatus, String> {
    #[cfg(target_os = "macos")]
    {
        macos::set_handler(&app.config().identifier)?;
        markdown_handler_status(app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("setting the default Markdown app is only supported on macOS".to_owned())
    }
}
