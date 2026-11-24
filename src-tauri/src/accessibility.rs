//! The Mac's display accessibility settings that change how the window is
//! drawn.

/// Whether the window's frame should be solid rather than glass: "Reduce
/// transparency" or "Increase contrast" is on in System Settings →
/// Accessibility → Display. Read on demand, so a change shows the next time
/// the app asks (it asks whenever the window comes to the front).
#[tauri::command]
pub fn solid_window_frame() -> bool {
    #[cfg(target_os = "macos")]
    {
        let workspace = objc2_app_kit::NSWorkspace::sharedWorkspace();
        workspace.accessibilityDisplayShouldReduceTransparency() || workspace.accessibilityDisplayShouldIncreaseContrast()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}
