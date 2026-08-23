//! Thin Tauri commands: resolve a harness from the registry, then delegate to the
//! trait, the credential store, or the smoke-test. Logic lives in
//! [`registry`](crate::harness::registry),
//! [`credentials`](crate::harness::credentials), and
//! [`verify`](crate::harness::verify).

use crate::harness::credentials::{Credential, CredentialStatus};
use crate::harness::registry::{compose_discover, compose_harness_by_id, compose_harness_catalog};
use crate::harness::verify::{self, HarnessRuntimeVerification};
use harness::{Harness, InstallCallback, InstallEvent, Listing, ModelChoice, Readiness};
use tauri::ipc::Channel;

pub(crate) fn resolve(harness_id: &str) -> Result<Box<dyn Harness>, String> {
    compose_harness_by_id(harness_id).ok_or_else(|| format!("Unknown assistant: {harness_id}"))
}

#[tauri::command(async)]
pub fn harness_list() -> Result<Vec<Listing>, String> {
    Ok(compose_harness_catalog())
}

/// Probe readiness of every registered harness in one call — drives the picker's
/// "what's already on your machine" detection. `(async)`: each probe may shell out.
#[tauri::command(async)]
pub fn harness_discover() -> Result<Vec<Readiness>, String> {
    let present = crate::harness::ollama_runtime::ollama_installed();
    Ok(compose_discover()
        .into_iter()
        .map(|readiness| with_local_install_truth(readiness, present))
        .collect())
}

#[tauri::command(async)]
pub fn harness_readiness(harness_id: String) -> Result<Readiness, String> {
    let readiness = resolve(&harness_id)?.readiness();
    let present = crate::harness::ollama_runtime::ollama_installed();
    Ok(with_local_install_truth(readiness, present))
}

const OLLAMA_ID: &str = "ollama";

/// Correct `installed` for the one local OpenAI-compatible endpoint.
///
/// The harness reports `installed: true` for all of them, because for a *hosted*
/// endpoint reachability is the only signal there is. Ollama is the exception: a
/// local app that can simply be absent. Left uncorrected, a missing Ollama reads
/// as merely "not running", so the composer offers to start an app that is not
/// there — and when that fails the notice has no next step, just "Try again".
/// Every downstream consumer already handles a truthful `installed`; this is the
/// only place the truth is known, since the platform check belongs to the host,
/// not to the cross-platform harness.
///
/// Only applied to a failed probe: a reachable Ollama is installed by
/// definition, and one served from another machine must not be judged by what
/// is on this one.
fn with_local_install_truth(mut readiness: Readiness, ollama_present: bool) -> Readiness {
    if readiness.harness_id == OLLAMA_ID && !readiness.ready {
        readiness.installed = ollama_present;
    }
    readiness
}

#[tauri::command(async)]
pub fn harness_list_models(harness_id: String) -> Result<Vec<ModelChoice>, String> {
    resolve(&harness_id)?.list_models().map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn harness_login(harness_id: String, on_event: Channel<InstallEvent>) -> Result<(), String> {
    let harness = resolve(&harness_id)?;
    let callback: InstallCallback = std::sync::Arc::new(move |event| {
        let _ = on_event.send(event);
    });
    harness.login(callback).map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn harness_verify_runtime(harness_id: String) -> Result<HarnessRuntimeVerification, String> {
    // The registry hands the harness its key as a value when it builds it, so
    // `resolve` already returns one that can authenticate.
    let harness = resolve(&harness_id)?;
    Ok(verify::run(harness.as_ref()))
}

#[tauri::command(async)]
pub fn harness_set_credential(harness_id: String, value: String) -> Result<(), String> {
    Credential::of(resolve(&harness_id)?.as_ref()).store(&value)
}

#[tauri::command(async)]
pub fn harness_credential_status(harness_id: String) -> Result<CredentialStatus, String> {
    Ok(Credential::of(resolve(&harness_id)?.as_ref()).status())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn readiness(harness_id: &str, ready: bool) -> Readiness {
        Readiness {
            harness_id: harness_id.to_owned(),
            ready,
            // What the harness always reports for an OpenAI-compatible endpoint.
            installed: true,
            version: None,
            auth_configured: ready,
            error: None,
            details: Value::Null,
        }
    }

    /// The reported bug: Ollama removed, so the composer offered to start an app
    /// that wasn't there and the failure had no next step. `installed: false` is
    /// what routes it to the install hand-off instead.
    #[test]
    fn an_absent_ollama_reports_not_installed() {
        let corrected = with_local_install_truth(readiness(OLLAMA_ID, false), false);
        assert!(!corrected.installed);
    }

    #[test]
    fn a_stopped_but_present_ollama_still_reports_installed() {
        // The other half: this one really is just "not running", and the
        // one-click start is the right offer.
        let corrected = with_local_install_truth(readiness(OLLAMA_ID, false), true);
        assert!(corrected.installed);
    }

    #[test]
    fn a_reachable_ollama_is_never_second_guessed() {
        // It answered, so it is installed — and it may be served from another
        // machine, where this host's filesystem says nothing.
        let corrected = with_local_install_truth(readiness(OLLAMA_ID, true), false);
        assert!(corrected.installed);
        assert!(corrected.ready);
    }

    #[test]
    fn other_harnesses_keep_what_they_reported() {
        // A hosted endpoint's `installed` is meaningful as-is; only Ollama is
        // a local app, so nothing else may be rewritten by this check.
        for id in ["openrouter", "claude", "codex"] {
            let corrected = with_local_install_truth(readiness(id, false), false);
            assert!(corrected.installed, "{id} must be left alone");
        }
    }
}
