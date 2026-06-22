//! Thin Tauri commands for the system dependency doctor + installer. Logic
//! lives in [`detect`](crate::system::detect),
//! [`install`](crate::system::install), and [`recipe`](crate::system::recipe).

use crate::system::detect::detect;
use crate::system::install::run_install;
use crate::system::recipe::{recipe_by_id, DependencyStatus, RECIPES};
use harness::{InstallCallback, InstallEvent};
use tauri::ipc::Channel;

/// Probe every recipe — "what developer tooling is already on this machine."
/// `(async)`: each probe shells out to a login shell.
#[tauri::command(async)]
pub fn system_readiness() -> Result<Vec<DependencyStatus>, String> {
    Ok(RECIPES.iter().map(detect).collect())
}

/// Install one dependency, streaming progress events to the front-end.
#[tauri::command(async)]
pub fn system_install_dependency(
    id: String,
    on_event: Channel<InstallEvent>,
) -> Result<(), String> {
    let recipe = recipe_by_id(&id).ok_or_else(|| format!("Unknown dependency: {id}"))?;
    let callback: InstallCallback = std::sync::Arc::new(move |event| {
        let _ = on_event.send(event);
    });
    run_install(recipe, callback);
    Ok(())
}
