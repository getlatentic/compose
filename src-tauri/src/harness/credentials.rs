//! Host-owned credentials. Compose stores each harness's API key in the OS
//! keychain and gives it to the harness only by exporting it into the env var the
//! harness reads — the harness never opens the keychain itself.

use harness::{CredentialSpec, Harness};
use serde::Serialize;

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
        let value = self.entry().ok()?.get_password().ok()?;
        (!value.trim().is_empty()).then_some(value)
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
}
