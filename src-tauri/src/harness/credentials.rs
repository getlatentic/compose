//! Host-owned credentials. Compose keeps each harness's API key in one
//! encrypted store and gives it to the harness only by exporting it into the
//! environment variable the harness reads — the harness never opens the store
//! itself.
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
        if spec.keychain_service.is_empty() || spec.keychain_account.is_empty() {
            continue;
        }
        if loaded.get(&spec.keychain_service).is_some() {
            continue;
        }
        let Ok(entry) = keyring::Entry::new(&spec.keychain_service, &spec.keychain_account) else {
            continue;
        };
        let Ok(value) = entry.get_password() else {
            continue;
        };
        if value.trim().is_empty() {
            continue;
        }
        if loaded.set(&spec.keychain_service, &value).is_ok() {
            // Only after the new store has it on disk — a failed write must not
            // lose the key.
            let _ = entry.delete_credential();
        }
    }
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
                Opened::KeyLost => {
                    return Err("Could not unlock the credential store. Reset it in Settings.".to_owned())
                }
            }
        }
        let store = guard.as_mut().ok_or("credential store is not initialised")?;
        store.set(&self.spec.keychain_service, value)?;
        if value.is_empty() {
            std::env::remove_var(&self.spec.keychain_account);
        } else {
            std::env::set_var(&self.spec.keychain_account, value);
        }
        Ok(())
    }

    pub fn export_to_env(&self) {
        if let Some(key) = self.read() {
            std::env::set_var(&self.spec.keychain_account, key);
        }
    }
}

/// Boot-time export of the host-configured providers' keys. One decrypt covers
/// every provider, so unlike the per-entry scheme this is a single read.
pub fn export_all() {
    for harness in super::registry::extra_harnesses() {
        Credential::of(harness.as_ref()).export_to_env();
    }
    for harness in super::custom::custom_agent_store().build_harnesses() {
        Credential::of(harness.as_ref()).export_to_env();
    }
}

/// Drop every stored key and the master key with it (the "Reset all data"
/// flow), then clear the exported environment variables so a running process
/// stops using what the user just deleted.
pub fn forget_all() {
    let specs = every_spec();
    if let Ok(mut guard) = store().lock() {
        if let Some(store) = guard.as_mut() {
            let _ = store.clear();
        }
        *guard = None;
    }
    for spec in specs {
        if !spec.keychain_account.is_empty() {
            std::env::remove_var(&spec.keychain_account);
        }
    }
}
