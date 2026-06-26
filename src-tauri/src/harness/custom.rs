//! User-defined "custom" agents — an ACP command or an OpenAI-compatible
//! endpoint the user registers at runtime. Persisted to the app config dir;
//! an agent's API key (if any) lives in the OS keychain, never this file.
//!
//! Held in a process-global store because [`crate::harness::registry::compose_registry`]
//! is a free function with no Tauri `State`, yet must fold these agents into the
//! registry on every call. Boot populates the global once from disk; the
//! add/update/remove commands mutate it (and persist) so the next registry build
//! sees the change without a restart.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use harness::{
    AcpHarness, AcpHarnessConfig, Harness, HarnessModel, OpenHarness, OpenHarnessConfig,
};
use serde::{Deserialize, Serialize};

const CUSTOM_AGENTS_FILE: &str = "custom_agents.json";
const PERSIST_VERSION: u32 = 1;
/// Prefix guaranteeing a custom id can't collide with a built-in (`claude`, …).
pub const CUSTOM_ID_PREFIX: &str = "custom:";

/// A custom agent's kind and its per-kind config. Tagged by `type` so the
/// frontend reads it as a discriminated union; serialized nested under `kind`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CustomAgentKind {
    /// An ACP server launched by `command` + `args`.
    Acp {
        command: String,
        #[serde(default)]
        args: Vec<String>,
    },
    /// An OpenAI-compatible endpoint. The key (when `requires_key`) is stored in
    /// the keychain under the id-derived env var, never in the record.
    #[serde(rename_all = "camelCase")]
    OpenAiCompatible {
        base_url: String,
        #[serde(default)]
        default_model: Option<String>,
        #[serde(default)]
        requires_key: bool,
    },
}

/// One persisted custom agent. `id` is assigned by the host (`custom:<uuid>`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgentRecord {
    pub id: String,
    pub display_name: String,
    pub kind: CustomAgentKind,
}

/// What the Add-agent form sends — a record without the host-assigned id.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomAgentInput {
    pub display_name: String,
    pub kind: CustomAgentKind,
}

impl CustomAgentInput {
    /// Pair the input with a host-assigned id to make a storable record.
    pub fn into_record(self, id: String) -> CustomAgentRecord {
        CustomAgentRecord {
            id,
            display_name: self.display_name,
            kind: self.kind,
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedCustomAgents {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    agents: Vec<CustomAgentRecord>,
}

#[derive(Default)]
struct CustomAgentState {
    persist_path: Option<PathBuf>,
    agents: Vec<CustomAgentRecord>,
}

#[derive(Default)]
pub struct CustomAgentStore {
    state: Mutex<CustomAgentState>,
}

static STORE: OnceLock<CustomAgentStore> = OnceLock::new();

/// The process-global custom-agent store. Empty (no persist path, so mutations
/// are no-ops) until [`CustomAgentStore::init_from_dir`] runs at boot.
pub fn custom_agent_store() -> &'static CustomAgentStore {
    STORE.get_or_init(CustomAgentStore::default)
}

/// The keychain account / env var a custom OpenAI agent reads its key from.
/// Derived from the id so two custom agents never share one key.
pub fn custom_api_key_env(id: &str) -> String {
    let slug: String = id
        .trim_start_matches(CUSTOM_ID_PREFIX)
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_uppercase() } else { '_' })
        .collect();
    format!("COMPOSE_CUSTOM_{slug}_API_KEY")
}

impl CustomAgentStore {
    fn lock(&self) -> Result<MutexGuard<'_, CustomAgentState>, String> {
        self.state
            .lock()
            .map_err(|_| "custom-agent store lock poisoned".to_owned())
    }

    /// Load the persisted agents from `config_dir/custom_agents.json` (absent →
    /// empty) and remember the path for later writes.
    pub fn init_from_dir(&self, config_dir: &Path) -> Result<(), String> {
        std::fs::create_dir_all(config_dir)
            .map_err(|error| format!("could not create config dir: {error}"))?;
        let persist_path = config_dir.join(CUSTOM_AGENTS_FILE);
        let loaded = load(&persist_path)?;
        let mut state = self.lock()?;
        state.persist_path = Some(persist_path);
        state.agents = loaded.agents;
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<CustomAgentRecord>, String> {
        Ok(self.lock()?.agents.clone())
    }

    /// Register a new agent. The id must be `custom:`-prefixed and unique.
    pub fn add(&self, mut record: CustomAgentRecord) -> Result<CustomAgentRecord, String> {
        record.display_name = record.display_name.trim().to_owned();
        validate(&record)?;
        let mut state = self.lock()?;
        if state.agents.iter().any(|agent| agent.id == record.id) {
            return Err(format!("an agent with id {} already exists", record.id));
        }
        state.agents.push(record.clone());
        persist(&state)?;
        Ok(record)
    }

    pub fn update(&self, mut record: CustomAgentRecord) -> Result<(), String> {
        record.display_name = record.display_name.trim().to_owned();
        validate(&record)?;
        let mut state = self.lock()?;
        let slot = state
            .agents
            .iter_mut()
            .find(|agent| agent.id == record.id)
            .ok_or_else(|| format!("no custom agent with id {}", record.id))?;
        *slot = record;
        persist(&state)
    }

    pub fn remove(&self, id: &str) -> Result<(), String> {
        let mut state = self.lock()?;
        let before = state.agents.len();
        state.agents.retain(|agent| agent.id != id);
        if state.agents.len() == before {
            return Err(format!("no custom agent with id {id}"));
        }
        persist(&state)
    }

    /// A live [`Harness`] for each record — what `compose_registry()` folds in.
    /// A poisoned lock yields no agents rather than panicking the registry.
    pub fn build_harnesses(&self) -> Vec<Box<dyn Harness>> {
        let agents = match self.lock() {
            Ok(state) => state.agents.clone(),
            Err(_) => return Vec::new(),
        };
        agents.into_iter().map(build_harness).collect()
    }
}

/// Construct a live [`Harness`] from one record (the registry + the remove
/// command's keychain cleanup both build from a record).
pub fn build_harness(record: CustomAgentRecord) -> Box<dyn Harness> {
    match record.kind {
        CustomAgentKind::Acp { command, args } => Box::new(AcpHarness::custom(AcpHarnessConfig {
            id: record.id,
            display_name: record.display_name,
            command,
            args,
        })),
        CustomAgentKind::OpenAiCompatible {
            base_url,
            default_model,
            requires_key,
        } => {
            let api_key_env = requires_key.then(|| custom_api_key_env(&record.id));
            let models = default_model
                .filter(|model| !model.trim().is_empty())
                .map(|model| {
                    vec![HarnessModel {
                        value: model.clone(),
                        label: model,
                    }]
                })
                .unwrap_or_default();
            Box::new(OpenHarness::custom(OpenHarnessConfig {
                id: record.id,
                display_name: record.display_name,
                base_url,
                api_key_env,
                models,
            }))
        }
    }
}

fn validate(record: &CustomAgentRecord) -> Result<(), String> {
    if !record.id.starts_with(CUSTOM_ID_PREFIX) {
        return Err(format!("custom agent id must start with `{CUSTOM_ID_PREFIX}`"));
    }
    if record.display_name.is_empty() {
        return Err("a name is required".to_owned());
    }
    match &record.kind {
        CustomAgentKind::Acp { command, .. } => {
            if command.trim().is_empty() {
                return Err("a command is required for an ACP agent".to_owned());
            }
        }
        CustomAgentKind::OpenAiCompatible { base_url, .. } => {
            let url = base_url.trim();
            if !url.starts_with("http://") && !url.starts_with("https://") {
                return Err("the base URL must start with http:// or https://".to_owned());
            }
        }
    }
    Ok(())
}

fn load(persist_path: &Path) -> Result<PersistedCustomAgents, String> {
    match std::fs::read_to_string(persist_path) {
        Ok(contents) if contents.trim().is_empty() => Ok(PersistedCustomAgents::default()),
        Ok(contents) => serde_json::from_str(&contents)
            .map_err(|error| format!("{CUSTOM_AGENTS_FILE} is malformed: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(PersistedCustomAgents::default())
        }
        Err(error) => Err(format!("could not read {CUSTOM_AGENTS_FILE}: {error}")),
    }
}

fn persist(state: &CustomAgentState) -> Result<(), String> {
    let Some(persist_path) = state.persist_path.as_ref() else {
        return Ok(());
    };
    let payload = PersistedCustomAgents {
        version: PERSIST_VERSION,
        agents: state.agents.clone(),
    };
    let serialized = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("could not serialize custom agents: {error}"))?;
    if let Some(parent) = persist_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not create config dir: {error}"))?;
    }
    std::fs::write(persist_path, serialized)
        .map_err(|error| format!("could not write {CUSTOM_AGENTS_FILE}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn acp(id: &str) -> CustomAgentRecord {
        CustomAgentRecord {
            id: id.to_owned(),
            display_name: "Gemini".to_owned(),
            kind: CustomAgentKind::Acp {
                command: "gemini".to_owned(),
                args: vec!["--experimental-acp".to_owned()],
            },
        }
    }

    fn openai(id: &str) -> CustomAgentRecord {
        CustomAgentRecord {
            id: id.to_owned(),
            display_name: "My Gateway".to_owned(),
            kind: CustomAgentKind::OpenAiCompatible {
                base_url: "https://gw.example.com".to_owned(),
                default_model: Some("gpt-4o".to_owned()),
                requires_key: true,
            },
        }
    }

    #[test]
    fn persists_and_reloads_from_disk() {
        let dir = tempdir().unwrap();
        let store = CustomAgentStore::default();
        store.init_from_dir(dir.path()).unwrap();
        store.add(acp("custom:a")).unwrap();
        store.add(openai("custom:b")).unwrap();

        let reloaded = CustomAgentStore::default();
        reloaded.init_from_dir(dir.path()).unwrap();
        assert_eq!(reloaded.list().unwrap(), vec![acp("custom:a"), openai("custom:b")]);
    }

    #[test]
    fn rejects_duplicate_and_unprefixed_ids() {
        let dir = tempdir().unwrap();
        let store = CustomAgentStore::default();
        store.init_from_dir(dir.path()).unwrap();
        store.add(acp("custom:a")).unwrap();
        assert!(store.add(acp("custom:a")).is_err(), "duplicate id");
        assert!(store.add(acp("bare-id")).is_err(), "missing custom: prefix");
    }

    #[test]
    fn remove_drops_the_agent() {
        let dir = tempdir().unwrap();
        let store = CustomAgentStore::default();
        store.init_from_dir(dir.path()).unwrap();
        store.add(acp("custom:a")).unwrap();
        store.remove("custom:a").unwrap();
        assert!(store.list().unwrap().is_empty());
        assert!(store.remove("custom:a").is_err(), "removing absent id errors");
    }

    #[test]
    fn builds_harnesses_with_matching_ids_and_derived_key_env() {
        let dir = tempdir().unwrap();
        let store = CustomAgentStore::default();
        store.init_from_dir(dir.path()).unwrap();
        store.add(acp("custom:gem")).unwrap();
        store.add(openai("custom:gw")).unwrap();

        let built = store.build_harnesses();
        let ids: Vec<String> = built.iter().map(|harness| harness.info().id).collect();
        assert_eq!(ids, vec!["custom:gem", "custom:gw"]);

        let gateway = built.iter().find(|harness| harness.info().id == "custom:gw").unwrap();
        assert_eq!(gateway.credential().keychain_account, custom_api_key_env("custom:gw"));
        assert_eq!(custom_api_key_env("custom:gw"), "COMPOSE_CUSTOM_GW_API_KEY");
    }
}
