//! The font families installed on this Mac, for the "Other…" reading font in
//! Settings → Appearance. Read from AppKit's font manager, the same list the
//! system font panel shows.

/// Installed family names, sorted for a picker. Synchronous so Tauri runs it
/// on the main thread, which the font manager requires.
#[tauri::command]
pub fn system_font_families() -> Result<Vec<String>, String> {
    installed_families().map(picker_order)
}

/// Hidden system faces (named with a leading dot) are left out; the rest are
/// sorted the way a reader scans a list, ignoring case, without repeats.
fn picker_order(names: Vec<String>) -> Vec<String> {
    let mut families: Vec<String> = names
        .into_iter()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty() && !name.starts_with('.'))
        .collect();
    families.sort_by_key(|name| name.to_lowercase());
    families.dedup();
    families
}

#[cfg(target_os = "macos")]
fn installed_families() -> Result<Vec<String>, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::NSFontManager;

    let mtm = MainThreadMarker::new().ok_or("the font list is read on the main thread")?;
    let manager = NSFontManager::sharedFontManager(mtm);
    let names = manager.availableFontFamilies();
    Ok(names.iter().map(|name| name.to_string()).collect())
}

#[cfg(not(target_os = "macos"))]
fn installed_families() -> Result<Vec<String>, String> {
    Ok(Vec::new())
}

#[cfg(test)]
mod tests {
    use super::picker_order;

    #[test]
    fn sorts_ignoring_case_and_drops_hidden_faces_and_repeats() {
        let names = ["avenir next", ".SF NS", "Baskerville", "Avenir Next", "  ", "Baskerville"]
            .map(String::from)
            .to_vec();
        assert_eq!(picker_order(names), vec!["avenir next", "Avenir Next", "Baskerville"]);
    }
}
