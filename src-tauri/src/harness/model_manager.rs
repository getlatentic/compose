//! Local-model management commands (Ollama): list installed models, pull a new
//! one with streamed progress, and delete one. All HTTP lives in the harness
//! crate ([`Harness::pull_model`] etc.); these commands resolve the harness,
//! delegate, and — for a pull — bridge its progress callback onto a Tauri
//! [`Channel`] and carry a cancel flag so the UI's Stop button can drop the
//! download.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use harness::{InstalledModel, ModelManagement, PullProgress, PullProgressAggregator};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::harness::commands::resolve;

/// In-flight pull cancellation flags, keyed by `harness_id` + model so the UI
/// can cancel a specific download. An entry exists only while a pull runs; the
/// command clears it on exit. (A pull is a one-shot stream, not a long-lived
/// `RunControl`, so it doesn't share the chat [`RunnerState`].)
#[derive(Default)]
pub struct ModelPullState {
    inner: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl ModelPullState {
    /// Register a fresh cancel flag for `key`, replacing (and cancelling) any
    /// stale pull still keyed there, so a re-pull never races an orphan flag.
    fn begin(&self, key: String) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = self.inner.lock() {
            if let Some(prev) = map.insert(key, Arc::clone(&flag)) {
                prev.store(true, Ordering::SeqCst);
            }
        }
        flag
    }

    /// Drop `key`'s flag once its pull has finished (success, error, or cancel).
    fn end(&self, key: &str) {
        if let Ok(mut map) = self.inner.lock() {
            map.remove(key);
        }
    }

    /// Flip the cancel flag for an in-flight pull; a no-op if none is keyed
    /// there (already finished or never started).
    fn cancel(&self, key: &str) {
        if let Ok(map) = self.inner.lock() {
            if let Some(flag) = map.get(key) {
                flag.store(true, Ordering::SeqCst);
            }
        }
    }
}

/// A model-pull progress event streamed to the UI over a Tauri [`Channel`].
/// `percent` is the aggregated overall download percentage (0–100), absent
/// until any byte total is known; `status` is the raw phase text from the
/// server (`"pulling manifest"`, a digest, `"success"`).
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PullEvent {
    #[serde(rename_all = "camelCase")]
    Progress {
        status: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        percent: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        digest: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        total: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        completed: Option<u64>,
    },
    Done,
    #[serde(rename_all = "camelCase")]
    Error {
        message: String,
    },
}

/// The model-management capability for a harness, or `None` when it manages no
/// models (every harness but Ollama today). The UI shows the "Manage models"
/// surface only when this is `Some`.
#[tauri::command(async)]
pub fn harness_model_management(harness_id: String) -> Result<Option<ModelManagement>, String> {
    Ok(resolve(&harness_id)?.model_management())
}

/// Installed local models with size + details, for the manager list.
#[tauri::command(async)]
pub fn harness_installed_models(harness_id: String) -> Result<Vec<InstalledModel>, String> {
    resolve(&harness_id)?.list_installed_models().map_err(|e| e.to_string())
}

/// Pull (download) a model, streaming progress onto `on_event`. Blocks until the
/// download finishes — `(async)` so it runs off the main thread. The UI cancels
/// via [`harness_cancel_pull`] with the same `harness_id` + `model`.
#[tauri::command(async)]
pub fn harness_pull_model(
    harness_id: String,
    model: String,
    on_event: Channel<PullEvent>,
    pulls: State<'_, ModelPullState>,
) -> Result<(), String> {
    let harness = resolve(&harness_id)?;
    let key = pull_key(&harness_id, &model);
    let cancel = pulls.begin(key.clone());

    let mut aggregate = PullProgressAggregator::default();
    let mut on_progress = |progress: PullProgress| {
        let percent = aggregate.update(&progress);
        let _ = on_event.send(PullEvent::Progress {
            status: progress.status,
            percent,
            digest: progress.digest,
            total: progress.total,
            completed: progress.completed,
        });
    };

    let result = harness.pull_model(&model, &cancel, &mut on_progress);
    pulls.end(&key);
    match result {
        Ok(()) => {
            let _ = on_event.send(PullEvent::Done);
            Ok(())
        }
        Err(error) => {
            let _ = on_event.send(PullEvent::Error { message: error.to_string() });
            Ok(())
        }
    }
}

/// Cancel an in-flight [`harness_pull_model`] for this `harness_id` + `model`.
/// The pull then ends with an error event and the connection drops.
#[tauri::command(async)]
pub fn harness_cancel_pull(harness_id: String, model: String, pulls: State<'_, ModelPullState>) -> Result<(), String> {
    pulls.cancel(&pull_key(&harness_id, &model));
    Ok(())
}

/// Delete an installed local model. Removing one already absent succeeds.
#[tauri::command(async)]
pub fn harness_delete_model(harness_id: String, model: String) -> Result<(), String> {
    resolve(&harness_id)?.delete_model(&model).map_err(|e| e.to_string())
}

/// Key an in-flight pull by harness + model. A `\n` separator can't appear in a
/// harness id or model name, so the parts never collide.
fn pull_key(harness_id: &str, model: &str) -> String {
    format!("{harness_id}\n{model}")
}
