//! Thin Tauri commands: resolve a harness from the registry, then delegate to the
//! trait, the credential store, or the smoke-test. Logic lives in
//! [`registry`](crate::harness::registry),
//! [`credentials`](crate::harness::credentials), and
//! [`verify`](crate::harness::verify).

use crate::harness::credentials::{Credential, CredentialStatus};
use crate::harness::registry::{compose_discover, compose_harness_by_id, compose_harness_catalog};
use crate::harness::verify::{self, HarnessRuntimeVerification};
use harness::{Harness, HarnessInfo, HarnessModel, HarnessReadiness, InstallCallback, InstallEvent};
use tauri::ipc::Channel;

pub(crate) fn resolve(harness_id: &str) -> Result<Box<dyn Harness>, String> {
    compose_harness_by_id(harness_id).ok_or_else(|| format!("Unknown assistant: {harness_id}"))
}

#[tauri::command(async)]
pub fn harness_list() -> Result<Vec<HarnessInfo>, String> {
    Ok(compose_harness_catalog())
}

/// Probe readiness of every registered harness in one call — drives the picker's
/// "what's already on your machine" detection. `(async)`: each probe may shell out.
#[tauri::command(async)]
pub fn harness_discover() -> Result<Vec<HarnessReadiness>, String> {
    Ok(compose_discover())
}

#[tauri::command(async)]
pub fn harness_readiness(harness_id: String) -> Result<HarnessReadiness, String> {
    Ok(resolve(&harness_id)?.readiness())
}

#[tauri::command(async)]
pub fn harness_list_models(harness_id: String) -> Result<Vec<HarnessModel>, String> {
    resolve(&harness_id)?.list_models().map_err(|e| e.to_string())
}

#[tauri::command(async)]
pub fn harness_install(harness_id: String, on_event: Channel<InstallEvent>) -> Result<(), String> {
    let harness = resolve(&harness_id)?;
    let callback: InstallCallback = std::sync::Arc::new(move |event| {
        let _ = on_event.send(event);
    });
    harness.install(callback).map_err(|e| e.to_string())
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
    let harness = resolve(&harness_id)?;
    // The adapter reads the key from the env, so export it before the run.
    Credential::of(harness.as_ref()).export_to_env();
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
