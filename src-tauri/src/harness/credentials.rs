//! Host-owned credentials. Compose stores each harness's API key in the OS
//! keychain and gives it to the harness only by exporting it into the env var the
//! harness reads — the harness never opens the keychain itself.

use harness::{CredentialSpec, Harness};
use serde::Serialize;

/// Keychain services this app stored keys under before the service was
/// standardized to the agent id (older builds used the bundle id / app name).
/// A key found under one of these for the same account is migrated forward on
/// read, so users upgrading from an old build keep their saved keys instead of
/// silently getting "Add a key".
const LEGACY_KEYCHAIN_SERVICES: &[&str] = &["ai.latentic.calibrate", "bob4everyone"];

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
        Self {
            spec: harness.credential(),
        }
    }

    /// False when the harness owns its auth (Claude/Codex) or needs none (Ollama).
    fn host_managed(&self) -> bool {
        self.spec.required && !self.spec.keychain_account.is_empty()
    }

    fn entry(&self) -> Result<keyring::Entry, String> {
        keyring::Entry::new(&self.spec.keychain_service, &self.spec.keychain_account)
            .map_err(|e| e.to_string())
    }

    pub fn read(&self) -> Option<String> {
        if !self.host_managed() {
            return None;
        }
        self.read_from(&self.spec.keychain_service)
            .or_else(|| self.read_legacy())
    }

    /// A non-empty key stored under `service` for this credential's account.
    fn read_from(&self, service: &str) -> Option<String> {
        let value = keyring::Entry::new(service, &self.spec.keychain_account)
            .ok()?
            .get_password()
            .ok()?;
        (!value.trim().is_empty()).then_some(value)
    }

    /// Look for the key under the app's former keychain services and, on a hit,
    /// carry it forward to the current service so later reads find it directly.
    fn read_legacy(&self) -> Option<String> {
        for service in LEGACY_KEYCHAIN_SERVICES {
            if let Some(value) = self.read_from(service) {
                let _ = self.store(&value);
                return Some(value);
            }
        }
        None
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
        let entry = self.entry()?;
        let value = value.trim();
        if value.is_empty() {
            let _ = entry.delete_credential();
            std::env::remove_var(&self.spec.keychain_account);
            return Ok(());
        }
        entry.set_password(value).map_err(|e| e.to_string())?;
        std::env::set_var(&self.spec.keychain_account, value);
        Ok(())
    }

    pub fn export_to_env(&self) {
        if let Some(key) = self.read() {
            std::env::set_var(&self.spec.keychain_account, key);
        }
    }
}

/// Boot-time export of the host-configured providers' keys. A built-in's key is
/// exported per-run instead, keeping boot off the keychain — a read on a
/// re-signed build can block on a macOS permission prompt.
pub fn export_all() {
    for harness in crate::harness::registry::extra_harnesses() {
        Credential::of(harness.as_ref()).export_to_env();
    }
    // User-registered OpenAI-compatible agents store a key the same way.
    for harness in crate::harness::custom::custom_agent_store().build_harnesses() {
        Credential::of(harness.as_ref()).export_to_env();
    }
}
