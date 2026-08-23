//! The optional local-AI dependency: Ollama. Compose detects it and — when it's
//! absent — hands the user to the official download, the same `InstallHint`
//! hand-off agents get: Compose discovers and runs local tools, it never
//! installs them.

use harness::InstallHint;
use serde::Serialize;

/// One detectable dependency: its identity, how to probe for it, and where the
/// user gets it when the probe comes back empty.
pub struct DependencyRecipe {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    /// Probe run through the user's login shell (so nvm/brew-installed binaries
    /// are visible); present iff it exits 0 and — when `min_version` is set —
    /// its reported version meets the floor.
    pub probe: &'static str,
    pub min_version: Option<&'static str>,
    pub hint_url: &'static str,
    pub hint_command: Option<&'static str>,
}

impl DependencyRecipe {
    pub fn hint(&self) -> InstallHint {
        InstallHint {
            url: self.hint_url.to_owned(),
            command: self.hint_command.map(str::to_owned),
        }
    }
}

/// Per-dependency status from the readiness probe. camelCase to match the
/// TypeScript consumer.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub present: bool,
    pub version: Option<String>,
    pub hint: InstallHint,
}

pub const RECIPES: &[DependencyRecipe] = &[DependencyRecipe {
    id: "ollama",
    name: "Ollama (local AI)",
    description: "Runs AI models privately on your Mac — no account needed. Models download separately, on demand.",
    // `ollama --version` prints connection warnings on stdout when the
    // server is down, so pull just the version number out.
    probe: "ollama --version 2>/dev/null | grep -oE '[0-9]+\\.[0-9]+\\.[0-9]+' | head -1",
    min_version: None,
    hint_url: "https://ollama.com/download",
    hint_command: None,
}];

#[cfg(test)]
mod tests {
    use super::*;

    /// The IPC wire shape the TypeScript `DependencyStatus` deserializes —
    /// camelCase keys, and the hint nested with the same shape agents use.
    #[test]
    fn status_wire_shape() {
        let status = DependencyStatus {
            id: "ollama".into(),
            name: "Ollama".into(),
            description: "d".into(),
            present: false,
            version: None,
            hint: RECIPES[0].hint(),
        };
        let json = serde_json::to_value(&status).expect("serialize");
        let object = json.as_object().expect("object");
        let keys: Vec<&str> = object.keys().map(String::as_str).collect();
        // serde_json sorts map keys; the contract is the SET of camelCase keys.
        assert_eq!(keys, ["description", "hint", "id", "name", "present", "version"]);
        assert_eq!(json["hint"]["url"], "https://ollama.com/download");
        assert!(json["hint"]["command"].is_null());
    }

    /// Every recipe must leave a usable hand-off: a real probe and an https
    /// download page.
    #[test]
    fn recipes_hand_off_somewhere() {
        for recipe in RECIPES {
            assert!(!recipe.probe.trim().is_empty(), "{} has no probe", recipe.id);
            assert!(
                recipe.hint_url.starts_with("https://"),
                "{} hint url must be https",
                recipe.id
            );
        }
    }
}
