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
    /// Keyed by `(harness id, model)` directly. Flattening the pair into a
    /// delimited string needs the delimiter to be impossible in either half,
    /// and nothing enforces that — a custom agent's id is only checked for its
    /// prefix. A tuple key cannot be forged and needs no such assumption.
    inner: Mutex<HashMap<PullKey, Arc<AtomicBool>>>,
}

/// Which download a cancel flag belongs to.
type PullKey = (String, String);

impl ModelPullState {
    /// Register a fresh cancel flag for `key`, replacing (and cancelling) any
    /// stale pull still keyed there, so a re-pull never races an orphan flag.
    fn begin(&self, key: PullKey) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut map) = self.inner.lock() {
            if let Some(prev) = map.insert(key, Arc::clone(&flag)) {
                prev.store(true, Ordering::SeqCst);
            }
        }
        flag
    }

    /// Drop `key`'s flag once its pull has finished (success, error, or cancel).
    fn end(&self, key: &PullKey) {
        if let Ok(mut map) = self.inner.lock() {
            map.remove(key);
        }
    }

    /// Flip the cancel flag for an in-flight pull; a no-op if none is keyed
    /// there (already finished or never started).
    fn cancel(&self, key: &PullKey) {
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
    let key = (harness_id.clone(), model.clone());
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
    pulls.cancel(&(harness_id, model));
    Ok(())
}

/// Delete an installed local model. Removing one already absent succeeds.
#[tauri::command(async)]
pub fn harness_delete_model(harness_id: String, model: String) -> Result<(), String> {
    resolve(&harness_id)?.delete_model(&model).map_err(|e| e.to_string())
}


#[cfg(test)]
mod tests {
    use super::*;

    fn key(harness: &str, model: &str) -> PullKey {
        (harness.to_owned(), model.to_owned())
    }

    #[test]
    fn a_repull_cancels_the_pull_it_replaces() {
        // Re-pulling the same model while one is already running would
        // otherwise leave two streams writing the same file, and the older
        // flag orphaned where nothing can reach it to stop it.
        let state = ModelPullState::default();
        let first = state.begin(key("ollama", "qwen"));
        assert!(!first.load(Ordering::SeqCst));

        let second = state.begin(key("ollama", "qwen"));
        assert!(first.load(Ordering::SeqCst), "the replaced pull is stopped");
        assert!(!second.load(Ordering::SeqCst), "the new one is not");
    }

    #[test]
    fn cancelling_reaches_the_pull_that_is_running() {
        let state = ModelPullState::default();
        let flag = state.begin(key("ollama", "qwen"));
        state.cancel(&key("ollama", "qwen"));
        assert!(flag.load(Ordering::SeqCst));
    }

    #[test]
    fn cancelling_a_finished_pull_is_a_no_op_not_a_panic() {
        // The command clears the entry on exit, so Cancel arriving just after a
        // download completes finds nothing — a normal race, not an error.
        let state = ModelPullState::default();
        let flag = state.begin(key("ollama", "qwen"));
        state.end(&key("ollama", "qwen"));
        state.cancel(&key("ollama", "qwen"));
        assert!(!flag.load(Ordering::SeqCst), "a cleared entry is unreachable");
        state.cancel(&key("never", "started"));
    }

    #[test]
    fn one_models_cancel_does_not_stop_another() {
        // Two pulls can run at once, and the key is the only thing keeping them
        // apart. A key that collapsed them would make Cancel a mystery.
        let state = ModelPullState::default();
        let qwen = state.begin(key("ollama", "qwen"));
        let llama = state.begin(key("ollama", "llama"));
        let other_harness = state.begin(key("lmstudio", "qwen"));

        state.cancel(&key("ollama", "qwen"));

        assert!(qwen.load(Ordering::SeqCst), "the named pull stops");
        assert!(!llama.load(Ordering::SeqCst), "a sibling model keeps going");
        assert!(!other_harness.load(Ordering::SeqCst), "so does the same model elsewhere");
    }

    #[test]
    fn a_name_containing_a_newline_cannot_impersonate_another_pull() {
        // This used to be a delimited string, and these two keys were byte
        // identical — one agent's Cancel stopped a different agent's download.
        // Nothing rejects a newline in a custom agent's id; only its prefix is
        // checked. The pair cannot be flattened, so it cannot be forged.
        let state = ModelPullState::default();
        let planted = state.begin(key("a\nb", "c"));
        let victim = state.begin(key("a", "b\nc"));

        state.cancel(&key("a\nb", "c"));

        assert!(planted.load(Ordering::SeqCst));
        assert!(!victim.load(Ordering::SeqCst), "a different pull is untouched");
    }

    #[test]
    fn progress_reaches_the_ui_kind_tagged_and_camel_case() {
        // The UI matches on `kind` and reads camelCase fields; serde will emit
        // whatever it is told, so a rename here is invisible until the progress
        // bar stops moving.
        let event = PullEvent::Progress {
            status: "pulling manifest".to_owned(),
            percent: Some(12.5),
            digest: Some("sha256:aa".to_owned()),
            total: Some(200),
            completed: Some(25),
        };
        let json = serde_json::to_value(&event).expect("serializes");
        assert_eq!(json["kind"], "progress");
        assert_eq!(json["status"], "pulling manifest");
        assert_eq!(json["percent"], 12.5);
        assert_eq!(json["completed"], 25);

        assert_eq!(serde_json::to_value(PullEvent::Done).unwrap()["kind"], "done");
        let failed = PullEvent::Error { message: "nope".to_owned() };
        let json = serde_json::to_value(&failed).unwrap();
        assert_eq!(json["kind"], "error");
        assert_eq!(json["message"], "nope");
    }

    #[test]
    fn counters_absent_before_a_download_starts_are_omitted_not_zero() {
        // "pulling manifest" has no byte totals yet. Emitting 0 would render a
        // bar sitting at 0% instead of an indeterminate one.
        let event = PullEvent::Progress {
            status: "pulling manifest".to_owned(),
            percent: None,
            digest: None,
            total: None,
            completed: None,
        };
        let json = serde_json::to_value(&event).expect("serializes");
        for absent in ["percent", "digest", "total", "completed"] {
            assert!(json.get(absent).is_none(), "{absent} should be omitted: {json}");
        }
    }
}
