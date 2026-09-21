//! The browser clipper's way in. A browser lets an extension talk to an app only
//! through a native-messaging host, found by a manifest in the browser's own
//! support folder. So at launch Compose writes one for every browser installed,
//! naming the host inside this bundle (`extensions/clipper`) and only the
//! clipper as allowed to start it.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

pub const HOST_NAME: &str = "ai.latentic.compose.clipper";

/// Chromium browsers know an extension by the id its public key hashes to:
/// compose-clipper's `config/chrome-extension-id.txt`.
const CHROMIUM_EXTENSION_IDS: &[&str] = &["oddcgacfdjkidphncjeolohjepipjkkb"];
/// Firefox knows it by the id in its manifest.
const FIREFOX_EXTENSION_ID: &str = "clipper@latentic.ai";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Family {
    Chromium,
    Firefox,
}

/// Each browser's folder under `~/Library/Application Support`.
const BROWSERS: &[(&str, Family)] = &[
    ("Google/Chrome", Family::Chromium),
    ("Google/Chrome Beta", Family::Chromium),
    ("Google/Chrome Canary", Family::Chromium),
    ("Chromium", Family::Chromium),
    ("Arc/User Data", Family::Chromium),
    ("Microsoft Edge", Family::Chromium),
    ("BraveSoftware/Brave-Browser", Family::Chromium),
    ("Vivaldi", Family::Chromium),
    ("Mozilla", Family::Firefox),
];

/// Register the host shipped in the bundle that is running, if it has one: a
/// development build has none, and the clipper then reports Compose as absent.
pub fn register_for_this_app() {
    let Some(host) = std::env::current_exe().ok().and_then(|exe| host_in_bundle(&exe)) else {
        return;
    };
    let Some(home) = std::env::var_os("HOME") else { return };
    let support = PathBuf::from(home).join("Library/Application Support");
    for failure in register(&host, &support).into_iter().filter_map(Result::err) {
        eprintln!("browser clipper: {failure}");
    }
}

/// `Contents/Helpers/ComposeClipper` beside the app's own `Contents/MacOS/`.
fn host_in_bundle(executable: &Path) -> Option<PathBuf> {
    let contents = executable.parent()?.parent()?;
    let host = contents.join("Helpers").join("ComposeClipper");
    host.is_file().then_some(host)
}

/// Write `host`'s manifest into every installed browser under `support`,
/// leaving one that already says the same thing untouched. A browser that is
/// not installed is skipped: its folder appears when it is, and the next launch
/// catches up. Returns what was written.
fn register(host: &Path, support: &Path) -> Vec<Result<PathBuf, String>> {
    BROWSERS
        .iter()
        .filter(|(folder, _)| support.join(folder).is_dir())
        .filter_map(|(folder, family)| {
            let path = support.join(folder).join("NativeMessagingHosts").join(format!("{HOST_NAME}.json"));
            let contents = serde_json::to_string_pretty(&manifest(host, *family)).ok()? + "\n";
            if std::fs::read_to_string(&path).is_ok_and(|current| current == contents) {
                return None;
            }
            Some(write(&path, &contents).map(|()| path))
        })
        .collect()
}

fn write(path: &Path, contents: &str) -> Result<(), String> {
    let describe = |error: std::io::Error| format!("{}: {error}", path.display());
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder).map_err(describe)?;
    }
    std::fs::write(path, contents).map_err(describe)
}

fn manifest(host: &Path, family: Family) -> Value {
    let mut manifest = json!({
        "name": HOST_NAME,
        "description": "Compose Web Clipper",
        "path": host.to_string_lossy(),
        "type": "stdio",
    });
    match family {
        Family::Chromium => {
            let origins: Vec<String> =
                CHROMIUM_EXTENSION_IDS.iter().map(|id| format!("chrome-extension://{id}/")).collect();
            manifest["allowed_origins"] = json!(origins);
        }
        Family::Firefox => manifest["allowed_extensions"] = json!([FIREFOX_EXTENSION_ID]),
    }
    manifest
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn read(path: &Path) -> Value {
        serde_json::from_str(&fs::read_to_string(path).expect("manifest")).expect("json")
    }

    fn written(results: Vec<Result<PathBuf, String>>) -> Vec<PathBuf> {
        results.into_iter().map(|result| result.expect("written")).collect()
    }

    #[test]
    fn every_installed_browser_is_told_where_the_host_is_and_nothing_else_is() {
        let support = tempfile::tempdir().expect("dir");
        fs::create_dir_all(support.path().join("Arc/User Data")).expect("arc");
        fs::create_dir_all(support.path().join("Mozilla")).expect("firefox");
        let host = Path::new("/Applications/Compose.app/Contents/Helpers/ComposeClipper");

        let paths = written(register(host, support.path()));

        let arc = support.path().join("Arc/User Data/NativeMessagingHosts/ai.latentic.compose.clipper.json");
        let firefox = support.path().join("Mozilla/NativeMessagingHosts/ai.latentic.compose.clipper.json");
        assert_eq!(paths, [arc.clone(), firefox.clone()]);
        assert!(!support.path().join("Google/Chrome").exists(), "an absent browser is left alone");

        let chromium = read(&arc);
        assert_eq!(chromium["name"], HOST_NAME);
        assert_eq!(chromium["path"], host.to_string_lossy().as_ref());
        assert_eq!(chromium["type"], "stdio");
        assert_eq!(chromium["allowed_origins"], json!(["chrome-extension://oddcgacfdjkidphncjeolohjepipjkkb/"]));
        assert_eq!(read(&firefox)["allowed_extensions"], json!(["clipper@latentic.ai"]));
    }

    #[test]
    fn a_manifest_that_already_says_the_same_is_not_rewritten() {
        let support = tempfile::tempdir().expect("dir");
        fs::create_dir_all(support.path().join("Google/Chrome")).expect("chrome");
        let host = Path::new("/Applications/Compose.app/Contents/Helpers/ComposeClipper");

        assert_eq!(written(register(host, support.path())).len(), 1);
        assert!(register(host, support.path()).is_empty(), "same host, nothing to write");
        let moved = Path::new("/Users/me/Applications/Compose.app/Contents/Helpers/ComposeClipper");
        assert_eq!(written(register(moved, support.path())).len(), 1, "a moved app is followed");
    }

    #[test]
    fn the_host_is_found_only_inside_an_app_bundle_that_ships_it() {
        let bundle = tempfile::tempdir().expect("dir");
        let contents = bundle.path().join("Compose.app/Contents");
        fs::create_dir_all(contents.join("MacOS")).expect("macos");
        let executable = contents.join("MacOS/compose");
        assert_eq!(host_in_bundle(&executable), None, "a development build ships no host");

        fs::create_dir_all(contents.join("Helpers")).expect("helpers");
        fs::write(contents.join("Helpers/ComposeClipper"), b"").expect("host");
        assert_eq!(host_in_bundle(&executable), Some(contents.join("Helpers/ComposeClipper")));
    }
}
