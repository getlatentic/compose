//! Tauri commands for user-registered custom agents. They drive the
//! process-global [`custom_agent_store`], whose mutators persist to disk so the
//! next `compose_registry()` build reflects the change. The agent's API key is
//! saved separately via `harness_set_credential` (which resolves the agent from
//! the registry) — so the Add-agent flow must add the agent *before* saving a
//! key.

use uuid::Uuid;

use super::credentials::Credential;
use super::custom::{
    build_harness, custom_agent_store, CustomAgentInput, CustomAgentRecord, CUSTOM_ID_PREFIX,
};

#[tauri::command]
pub fn harness_list_custom() -> Result<Vec<CustomAgentRecord>, String> {
    custom_agent_store().list()
}

#[tauri::command]
pub fn harness_add_custom(input: CustomAgentInput) -> Result<CustomAgentRecord, String> {
    let id = format!("{CUSTOM_ID_PREFIX}{}", Uuid::new_v4());
    custom_agent_store().add(input.into_record(id))
}

#[tauri::command]
pub fn harness_update_custom(record: CustomAgentRecord) -> Result<(), String> {
    custom_agent_store().update(record)
}

#[tauri::command]
pub fn harness_remove_custom(id: String) -> Result<(), String> {
    // Clear any saved key before dropping the record so no orphaned secret
    // lingers in the keychain. `store("")` is a no-op for a keyless (ACP) agent.
    if let Some(record) = custom_agent_store()
        .list()?
        .into_iter()
        .find(|record| record.id == id)
    {
        let _ = Credential::of(build_harness(record).as_ref()).store("");
    }
    custom_agent_store().remove(&id)
}
