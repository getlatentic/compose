//! Host-owned credentials. Compose keeps each harness's API key in one
//! encrypted store and hands it to the harness as a value when the registry
//! builds it — the harness never opens the store, and the key never becomes an
//! environment variable, which every child the agent spawns would inherit.
//!
//! Storage moved from one OS-vault entry per harness to a single entry holding
//! a master key, with the secrets in an encrypted file
//! ([`super::secret_store`]). The reason is portability: a vault entry per
//! secret assumes a vault that always exists, which is true on macOS and
//! Windows and not on Linux. Keys written by the old scheme migrate on first
//! load, so nobody re-enters anything.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use harness::{CredentialSpec, Harness};
use serde::Serialize;

use super::secret_store::{Opened, SecretStore};

/// The process-wide store. `None` until [`init_from_dir`] runs at boot, and
/// again if the master key was lost — in which case reads return nothing and
/// writes mint a fresh store, which is exactly "re-enter your keys".
static STORE: OnceLock<Mutex<Option<SecretStore>>> = OnceLock::new();
static CONFIG_DIR: OnceLock<PathBuf> = OnceLock::new();

fn store() -> &'static Mutex<Option<SecretStore>> {
    STORE.get_or_init(|| Mutex::new(None))
}

/// Load the store and fold in any keys written by the per-entry scheme.
/// Returns whether the previous secrets were unrecoverable, so the host can
/// say so rather than leaving the user wondering where their key went.
pub fn init_from_dir(config_dir: &std::path::Path) -> Result<bool, String> {
    let _ = CONFIG_DIR.set(config_dir.to_path_buf());
    match SecretStore::load(config_dir)? {
        Opened::Ready(mut loaded) => {
            migrate_legacy_entries(&mut loaded);
            *store().lock().map_err(|_| "credential store lock poisoned")? = Some(loaded);
            Ok(false)
        }
        Opened::KeyLost => Ok(true),
    }
}

/// Move keys written by the old one-entry-per-harness scheme into the store.
///
/// The old entries were generic passwords keyed by the harness's
/// `keychain_service` + `keychain_account`, which is what `keyring` reads too —
/// so this needs no platform-specific code. Each is deleted once carried over,
/// leaving a single vault entry behind as intended.
fn migrate_legacy_entries(loaded: &mut SecretStore) {
    for spec in every_spec() {
        if spec.keychain_service.is_empty() {
            continue;
        }
        if loaded.get(&spec.keychain_service).is_some() {
            continue;
        }
        for account in legacy_accounts(&spec) {
            let Ok(entry) = keyring::Entry::new(&spec.keychain_service, &account) else {
                continue;
            };
            let Ok(value) = entry.get_password() else {
                continue;
            };
            if value.trim().is_empty() {
                continue;
            }
            if loaded.set(&spec.keychain_service, &value).is_ok() {
                // Only after the new store has it on disk — a failed write must
                // not lose the key.
                let _ = entry.delete_credential();
            }
            break;
        }
    }
}

/// Account names an old entry may sit under, newest naming first.
///
/// The per-entry scheme keyed the account by the environment variable the
/// harness read — `OPENROUTER_API_KEY`, or `COMPOSE_CUSTOM_<ID>_API_KEY` for a
/// user's own endpoint. Now that no variable is involved, the account is the
/// provider id, so a migration that looked only at today's name would walk
/// straight past everyone's saved key.
fn legacy_accounts(spec: &CredentialSpec) -> Vec<String> {
    let mut names = Vec::new();
    if !spec.keychain_account.is_empty() {
        names.push(spec.keychain_account.clone());
    }
    let derived = super::custom::custom_api_key_env(&spec.keychain_service);
    if !names.contains(&derived) {
        names.push(derived);
    }
    // The built-in providers' old variable names.
    for legacy in ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"] {
        if !names.iter().any(|n| n == legacy) {
            names.push(legacy.to_owned());
        }
    }
    names
}

/// Every harness that can hold a host-stored key: the configured providers plus
/// the user's own OpenAI-compatible agents.
fn every_spec() -> Vec<CredentialSpec> {
    let mut specs: Vec<CredentialSpec> = super::registry::extra_harnesses()
        .iter()
        .map(|harness| harness.credential())
        .collect();
    specs.extend(
        super::custom::custom_agent_store()
            .build_harnesses()
            .iter()
            .map(|harness| harness.credential()),
    );
    specs
}

/// The stored secret for a provider id, for handing to a harness as a value.
///
/// Used at construction time by the registry so the key reaches the adapter
/// without passing through the environment, where the agent's own shell tool
/// would inherit it.
pub fn secret_for(provider_id: &str) -> Option<String> {
    let guard = store().lock().ok()?;
    let value = guard.as_ref()?.get(provider_id)?;
    (!value.trim().is_empty()).then(|| value.to_owned())
}

pub struct Credential {
    spec: CredentialSpec,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub configured: bool,
}

impl Credential {
    pub fn of(harness: &dyn Harness) -> Self {
        Self { spec: harness.credential() }
    }

    /// False when the harness owns its auth (Claude/Codex) or needs none (Ollama).
    fn host_managed(&self) -> bool {
        self.spec.required && !self.spec.keychain_account.is_empty()
    }

    pub fn read(&self) -> Option<String> {
        if !self.host_managed() {
            return None;
        }
        let guard = store().lock().ok()?;
        let value = guard.as_ref()?.get(&self.spec.keychain_service)?;
        (!value.trim().is_empty()).then(|| value.to_owned())
    }

    pub fn status(&self) -> CredentialStatus {
        CredentialStatus {
            configured: !self.host_managed() || self.read().is_some(),
        }
    }

    /// An empty value clears the slot.
    pub fn store(&self, value: &str) -> Result<(), String> {
        if !self.host_managed() {
            return Err("This assistant does not take an API key here.".to_owned());
        }
        let value = value.trim();
        let mut guard = store().lock().map_err(|_| "credential store lock poisoned")?;
        // A lost master key leaves no store. Saving a key is the recovery, so
        // build a fresh one rather than refusing the write.
        if guard.is_none() {
            let dir = CONFIG_DIR.get().ok_or("credential store is not initialised")?;
            match SecretStore::load(dir)? {
                Opened::Ready(fresh) => *guard = Some(fresh),
                // Do what the comment above promises. The file cannot be
                // opened by any key that exists, and the user is in the middle
                // of saying "save this key" — refusing left them permanently
                // unable to, with "Reset it in Settings" (which erases every
                // workspace and conversation) as the only way out.
                Opened::KeyLost => *guard = Some(SecretStore::recover(dir)?),
            }
        }
        let store = guard.as_mut().ok_or("credential store is not initialised")?;
        store.set(&self.spec.keychain_service, value)?;
        // Deliberately not exported. The registry rebuilds each harness per
        // call and reads the value straight from the store, so a variable would
        // add nothing but reach — every child the agent spawns inherits it.
        Ok(())
    }

}

/// Drop every stored key and the master key with it (the "Reset all data" flow).
pub fn forget_all() {
    if let Ok(mut guard) = store().lock() {
        if let Some(store) = guard.as_mut() {
            let _ = store.clear();
        }
        *guard = None;
    }
}
