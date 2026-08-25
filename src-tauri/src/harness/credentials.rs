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

/// The process-wide store. `None` until something first needs a credential —
/// boot only records the directory, because opening this reads the keychain.
/// It stays `None` when the master key was lost, in which case reads return
/// nothing and writes mint a fresh store, which is exactly "re-enter your keys".
static STORE: OnceLock<Mutex<Option<SecretStore>>> = OnceLock::new();
static CONFIG_DIR: OnceLock<PathBuf> = OnceLock::new();

fn store() -> &'static Mutex<Option<SecretStore>> {
    STORE.get_or_init(|| Mutex::new(None))
}

/// Record where the store lives. Deliberately no I/O.
///
/// Opening it reads the OS keychain, and this runs inside Tauri's `setup`,
/// before `app.run()`. A keychain read there is not merely slow: on a machine
/// whose login keychain locks, it raises a modal unlock prompt with no window
/// behind it yet. The launches that need a credential at all are the minority —
/// an agent with its own auth (Claude, Codex) or none (Ollama) never asks — so
/// the store opens on first use instead. See `loaded_for_read` / `loaded_for_write`.
pub fn set_config_dir(config_dir: &std::path::Path) {
    let _ = CONFIG_DIR.set(config_dir.to_path_buf());
}

/// Open the store for a READ, migrating anything the old per-harness scheme
/// left behind.
///
/// A lost key yields `None` rather than recovering: recovery mints a master key
/// and moves a file aside, and a read must not do either. Saving is where that
/// belongs, because there the user has said what to put in the new store.
fn loaded_for_read(guard: &mut Option<SecretStore>) -> Option<&mut SecretStore> {
    if guard.is_none() {
        let dir = CONFIG_DIR.get()?;
        match SecretStore::load(dir).ok()? {
            Opened::Ready(mut fresh) => {
                migrate_legacy_entries(&mut fresh);
                *guard = Some(fresh);
            }
            Opened::KeyLost => return None,
        }
    }
    guard.as_mut()
}

/// Open the store for a WRITE, recovering from a lost master key rather than
/// refusing — the caller is in the middle of saving a key.
fn loaded_for_write(guard: &mut Option<SecretStore>) -> Result<&mut SecretStore, String> {
    if guard.is_none() {
        let dir = CONFIG_DIR.get().ok_or("credential store is not initialised")?;
        *guard = Some(match SecretStore::load(dir)? {
            Opened::Ready(mut fresh) => {
                migrate_legacy_entries(&mut fresh);
                fresh
            }
            Opened::KeyLost => SecretStore::recover(dir)?,
        });
    }
    guard.as_mut().ok_or_else(|| "credential store is not initialised".to_owned())
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
    let mut guard = store().lock().ok()?;
    let value = loaded_for_read(&mut guard)?.get(provider_id)?.to_owned();
    (!value.trim().is_empty()).then_some(value)
}

pub struct Credential {
    spec: CredentialSpec,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub configured: bool,
    /// Enough of the stored key to recognise WHICH one it is, and no more.
    /// `None` when nothing is stored, or when the value is too short to show
    /// any of without giving most of it away.
    pub hint: Option<String>,
}

/// `sk-or…9f2c` — the shape every provider uses to list keys it will not show
/// again. The point is telling a stale key from the current one; it is not a
/// redaction of something the user may later reveal, because nothing here ever
/// reveals it.
///
/// Short values get no characters at all. A hint is only safe while it is a
/// small fraction of the secret, and "small fraction" stops being true fast.
fn hint_for(secret: &str) -> Option<String> {
    const HEAD: usize = 5;
    const TAIL: usize = 4;
    /// Below this, HEAD + TAIL would be most of the value.
    const MIN_LEN: usize = 16;

    let secret = secret.trim();
    if secret.is_empty() {
        return None;
    }
    let chars: Vec<char> = secret.chars().collect();
    if chars.len() < MIN_LEN {
        return Some("•".repeat(8));
    }
    let head: String = chars[..HEAD].iter().collect();
    let tail: String = chars[chars.len() - TAIL..].iter().collect();
    Some(format!("{head}…{tail}"))
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
        let mut guard = store().lock().ok()?;
        let value = loaded_for_read(&mut guard)?.get(&self.spec.keychain_service)?.to_owned();
        (!value.trim().is_empty()).then_some(value)
    }

    pub fn status(&self) -> CredentialStatus {
        let stored = self.read();
        CredentialStatus {
            configured: !self.host_managed() || stored.is_some(),
            hint: stored.as_deref().and_then(hint_for),
        }
    }

    /// An empty value clears the slot.
    pub fn store(&self, value: &str) -> Result<(), String> {
        if !self.host_managed() {
            return Err("This assistant does not take an API key here.".to_owned());
        }
        let value = value.trim();
        let mut guard = store().lock().map_err(|_| "credential store lock poisoned")?;
        loaded_for_write(&mut guard)?.set(&self.spec.keychain_service, value)?;
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

#[cfg(test)]
mod hint_tests {
    use super::hint_for;

    #[test]
    fn shows_enough_to_tell_two_keys_apart() {
        assert_eq!(
            hint_for("sk-or-v1-0123456789abcdef9f2c").as_deref(),
            Some("sk-or…9f2c"),
        );
    }

    #[test]
    fn a_short_value_gives_up_no_characters() {
        // The guard that matters. Head + tail on a short secret is most of it,
        // and a hint is only safe while it stays a small fraction.
        for short in ["abc", "sk-1234", "123456789012345"] {
            let hint = hint_for(short).expect("something");
            assert!(
                !hint.contains(|c: char| c.is_ascii_alphanumeric()),
                "{short} leaked characters through its hint: {hint}",
            );
        }
    }

    #[test]
    fn nothing_stored_is_nothing_to_hint_at() {
        assert_eq!(hint_for(""), None);
        assert_eq!(hint_for("   "), None);
    }

    #[test]
    fn never_reveals_more_than_a_fraction() {
        let secret = "sk-or-v1-".to_owned() + &"a".repeat(48);
        let hint = hint_for(&secret).expect("a hint");
        let revealed = hint.chars().filter(|c| *c != '…').count();
        assert!(
            revealed * 4 < secret.chars().count(),
            "hint revealed {revealed} of {} characters",
            secret.chars().count(),
        );
    }
}
