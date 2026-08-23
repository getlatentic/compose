//! Thin Tauri command for the system dependency probe. Logic lives in
//! [`detect`](crate::system::detect) and [`recipe`](crate::system::recipe).

use crate::system::detect::detect;
use crate::system::recipe::{DependencyStatus, RECIPES};

/// Probe every recipe — "what local-AI tooling is already on this machine."
/// `(async)`: each probe shells out to a login shell.
#[tauri::command(async)]
pub fn system_readiness() -> Result<Vec<DependencyStatus>, String> {
    Ok(RECIPES.iter().map(detect).collect())
}
