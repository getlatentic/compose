//! Host-owned credentials. Compose stores each harness's API key in the OS
//! keychain and gives it to the harness only by exporting it into the env var the
//! harness reads — the harness never opens the keychain itself.
//!
//! Keys are stored per-app (the default file keychain), keyed by the harness's
//! service + account. Sharing them across the Latentic apps via a keychain
//! access group is deferred: `keychain-access-groups` is a provisioning-profile-
//! restricted entitlement, and adding it without an embedded profile makes AMFI
//! kill the app at launch — so the shared group needs a Developer ID provisioning
//! profile (and Calibrate's side) before it can ship. See compose#16.

use harness::{CredentialSpec, Harness};
use security_framework::passwords::{
    delete_generic_password_options, generic_password, set_generic_password_options, PasswordOptions,
};
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

    /// A keychain query keyed by the harness's service + account (e.g. service
    /// `openrouter`, account `OPENROUTER_API_KEY`).
    fn options(&self) -> PasswordOptions {
        PasswordOptions::new_generic_password(
            &self.spec.keychain_service,
            &self.spec.keychain_account,
        )
    }

    pub fn read(&self) -> Option<String> {
        if !self.host_managed() {
            return None;
        }
        let value = String::from_utf8(generic_password(self.options()).ok()?).ok()?;
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
        let value = value.trim();
        if value.is_empty() {
            let _ = delete_generic_password_options(self.options());
            std::env::remove_var(&self.spec.keychain_account);
            return Ok(());
        }
        set_generic_password_options(value.as_bytes(), self.options()).map_err(|e| e.to_string())?;
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

/// Delete every host-managed key from the keychain (the "Reset all data" flow).
/// A `store("")` on a harness that owns its own auth (Claude/Codex/Ollama) is a
/// no-op error, so iterating the same set as `export_all` is safe.
pub fn forget_all() {
    for harness in crate::harness::registry::extra_harnesses() {
        let _ = Credential::of(harness.as_ref()).store("");
    }
    for harness in crate::harness::custom::custom_agent_store().build_harnesses() {
        let _ = Credential::of(harness.as_ref()).store("");
    }
}
