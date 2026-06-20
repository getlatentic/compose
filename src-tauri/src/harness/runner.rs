//! Tauri-side harness runner.
//!
//! Every harness — bob included — runs through the generic
//! `agent-harness` registry via `run_via_harness`: resolve the
//! harness, derive its working dir through the edit-review gate
//! (`prepare_edit_guard`), build a neutral `RunRequest`, and stream
//! its normalized `RunEvent`s onto the `HARNESS_RUN_EVENT` channel.
//! bob is no longer special-cased here — its old bespoke spawn path
//! and `BobChatMapper` raw-stream interpretation are gone.
//!
//! What lives here:
//!   * `HarnessRunRequest` (the IPC request shape) and the
//!     `run_harness_stream` / `cancel_harness_run` commands.
//!   * Run-id keyed `RunnerState` so `cancel_harness_run` can find
//!     the right handle — works for any harness, since bob's
//!     `ProcessHandle` and the generic `RunHandle` both implement
//!     `RunControl`.
//!   * Bridging the neutral `RunEvent` stream to Tauri's `app.emit`
//!     via `run_event_to_chat` (→ Compose's `ChatEvent`).

use crate::db::MetadataStore;
use crate::harness::chat_event::{run_event_to_chat, ChatEvent};
use crate::harness::credentials::Credential;
use crate::harness::registry::compose_harness_by_id;
use crate::harness::{ApprovalMode, ChatMode};
use crate::review::{prepare_edit_guard, EditGuard, ReviewSessionStore};
use crate::workspace::WorkspaceRegistry;
use harness::{ReasoningEffort, RunCallback, RunControl, RunEvent, RunMode, RunRequest, RunTuning};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub const HARNESS_RUN_EVENT: &str = "harness_run";

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HarnessRunRequest {
    pub approval_mode: ApprovalMode,
    pub chat_mode: ChatMode,
    #[serde(default)]
    pub context_file_paths: Vec<String>,
    pub max_coins: u32,
    pub prompt: String,
    pub run_id: String,
    pub workspace_id: String,
    /// Which harness to run. Defaults to `"bob"`; every id — bob
    /// included — routes through the `agent-harness` registry
    /// (`run_via_harness`).
    #[serde(default = "default_harness_id")]
    pub harness_id: String,
    /// Per-harness run tuning the Settings picker exposes, threaded to
    /// the adapter via `run_via_harness`. Each adapter maps the subset
    /// its CLI supports (claude: model + max-turns; codex: model +
    /// effort) and ignores the rest — bob declares none of these
    /// capabilities, so it ignores all three. All optional — omitted →
    /// the CLI's own defaults.
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<ReasoningEffort>,
    #[serde(default)]
    pub max_turns: Option<u32>,
    /// How this run's edits should be guarded — chosen by the frontend per
    /// harness from its capabilities + the user's "review edits" toggle.
    /// `none` skips the gate (a read-only plan/ask run); `snapshot` records an
    /// undo baseline before direct edits (the write-capable default — bob
    /// included, now that it writes directly in `auto_edit`); `clone` runs the
    /// harness against a sandbox the user approves. `run_via_harness` acts on
    /// it for every harness.
    #[serde(default)]
    pub edit_guard: EditGuard,
    /// Extra CLI args the frontend builds from config (the per-harness
    /// permission-mode setting + Compose's default) and threads to the harness
    /// via `RunTuning.extra_args`. Run *policy* lives in the frontend; the
    /// backend just passes it through. Empty → the adapter's own defaults.
    #[serde(default)]
    pub extra_args: Vec<String>,
    /// The user's per-harness "custom instructions", appended to the system
    /// prompt via `RunTuning.extra_instructions`. Honored by the
    /// `openai-compatible` adapter (Ollama / OpenRouter); ignored by the rest.
    #[serde(default)]
    pub extra_instructions: Option<String>,
}

fn default_harness_id() -> String {
    harness::DEFAULT_HARNESS_ID.to_owned()
}

// The IPC event shape is Compose's own `chat_event::ChatEvent` — the
// three-surface chat vocabulary the front-end renders (started / text /
// notice / thinking / toolStart{input} / toolEnd{output} / session /
// usage / suggestedEdits / activity / error / exited). It is *not* a
// harness type: `agent-harness` returns the model's output faithfully as a
// neutral `RunEvent`, and Compose decides what it means by mapping it
// through `run_event_to_chat` — one bridge for every harness. (The old
// src-tauri-local `BobRunEvent` type carried `workspace_id` on Started; the
// front-end correlates by the per-run subscription closure, not that field,
// so it's gone.)

#[derive(Default)]
pub struct RunnerState {
    inner: Arc<Mutex<RunnerInner>>,
}

#[derive(Default)]
struct RunnerInner {
    runs: HashMap<String, ActiveRun>,
}

/// Per-run state stored in the registry.
///
/// `cancelled` is always present and lets the user click Stop
/// **before** the child has been spawned — useful when the
/// preparation step (workspace lookup, API key resolution,
/// `bob` executable probe) blocks on the OS keychain prompt or
/// any other slow IO.
///
/// `handle` only becomes `Some` once the child process is up.
/// During the "pending spawn" window between `cancel_harness_run`
/// being invokable and the actual bob process existing, only the
/// `cancelled` flag carries the user's intent.
struct ActiveRun {
    cancelled: Arc<AtomicBool>,
    // `Box<dyn RunControl>` so the same registry/cancel machinery
    // works for any harness: bob's `ProcessHandle` and the generic
    // harness `RunHandle` both implement `RunControl`.
    handle: Mutex<Option<Box<dyn RunControl>>>,
}

impl ActiveRun {
    fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            handle: Mutex::new(None),
        }
    }
}

impl RunnerState {
    pub fn cancel(&self, run_id: &str) -> Result<(), String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "harness runner lock was poisoned".to_owned())?;
        let Some(run) = inner.runs.get(run_id) else {
            return Err("run is not active".to_owned());
        };
        // Flip the flag first — this lets a still-preparing
        // spawn bail out the moment its blocking work returns.
        run.cancelled.store(true, Ordering::SeqCst);
        // If the child is already alive, signal it too. `RunControl::cancel`
        // returns the typed `HarnessError`; stringify it for the Tauri boundary.
        if let Ok(guard) = run.handle.lock() {
            if let Some(handle) = guard.as_ref() {
                return handle.cancel().map_err(|e| e.to_string());
            }
        }
        Ok(())
    }

    /// Register a placeholder run before doing any blocking
    /// preparation. Returns the cancellation token so the
    /// preparation phase can check whether to abort.
    fn register_pending(&self, run_id: String) -> Result<Arc<AtomicBool>, String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "harness runner lock was poisoned".to_owned())?;
        let run = ActiveRun::new();
        let token = Arc::clone(&run.cancelled);
        inner.runs.insert(run_id, run);
        Ok(token)
    }

    /// Attach the spawned bob handle to an already-registered
    /// pending run. If the user cancelled while we were
    /// preparing, the handle is dropped (and bob is cancelled)
    /// immediately so we don't accidentally hold a zombie.
    fn attach_handle(&self, run_id: &str, handle: Box<dyn RunControl>) -> Result<(), String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "harness runner lock was poisoned".to_owned())?;
        let Some(run) = inner.runs.get(run_id) else {
            // Run was deregistered (likely by the exit pump).
            // Just cancel the handle to avoid leaking the process.
            let _ = handle.cancel();
            return Ok(());
        };
        if run.cancelled.load(Ordering::SeqCst) {
            // User clicked Stop while we were preparing. Honor
            // it: cancel the bob process we just spawned and
            // skip attaching.
            let _ = handle.cancel();
            return Ok(());
        }
        if let Ok(mut guard) = run.handle.lock() {
            *guard = Some(handle);
        }
        Ok(())
    }

    fn unregister(&self, run_id: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.runs.remove(run_id);
        }
    }
}

#[tauri::command(async)]
pub fn run_harness_stream(
    request: HarnessRunRequest,
    registry: State<'_, WorkspaceRegistry>,
    runner: State<'_, RunnerState>,
    metadata: State<'_, MetadataStore>,
    review: State<'_, ReviewSessionStore>,
    app: AppHandle,
) -> Result<(), String> {
    // Register the run as "pending" up front. From this moment
    // forward, `cancel_harness_run(run_id)` finds an entry and can
    // flip the cancellation token — even if we're still blocked
    // inside the run's preparation phase (e.g. a keychain read).
    let cancel_token = runner.register_pending(request.run_id.clone())?;
    let run_id = request.run_id.clone();

    // Emit Started immediately so the front-end can flip the
    // chat-thread state to "starting" before the (potentially
    // slow) preparation phase. Doing this even when the user
    // ends up cancelling is fine — they'll get the matching
    // Exited{cancelled:true} a moment later.
    let _ = app.emit(
        HARNESS_RUN_EVENT,
        &ChatEvent::Started {
            run_id: run_id.clone(),
        },
    );

    // Defensive: bail if the user already pressed Stop in the
    // microsecond between starting and now. (Mostly relevant
    // when run preparation is itself fast and the second-IPC
    // window is real.)
    if cancel_token.load(Ordering::SeqCst) {
        let _ = app.emit(
            HARNESS_RUN_EVENT,
            &ChatEvent::Exited {
                run_id: run_id.clone(),
                exit_code: None,
                cancelled: true,
            },
        );
        runner.unregister(&run_id);
        return Ok(());
    }

    // Every harness — bob included — runs through the generic agent-harness
    // registry. bob is no longer special-cased: it runs edit-capable in
    // `auto_edit` (writing files directly) and is reviewed by the same edit
    // gate as Claude/Codex (see `editGuardFor` → `prepare_edit_guard`).
    let harness_id = if request.harness_id.trim().is_empty() {
        harness::DEFAULT_HARNESS_ID.to_owned()
    } else {
        request.harness_id.clone()
    };
    run_via_harness(&harness_id, request, &registry, &runner, &metadata, &review, app)
}

#[tauri::command(async)]
pub fn cancel_harness_run(run_id: String, runner: State<'_, RunnerState>) -> Result<(), String> {
    runner.cancel(&run_id)
}

/// Run a harness through the `agent-harness` registry: resolve the harness,
/// derive its working dir through the edit-review gate, build a neutral
/// `RunRequest`, and stream its normalized `RunEvent`s on the IPC channel +
/// runner state. Every harness — bob, Claude Code, Codex, and any future
/// adapter — goes through here, so cancellation and run bookkeeping are
/// identical across all of them.
fn run_via_harness(
    harness_id: &str,
    request: HarnessRunRequest,
    registry: &WorkspaceRegistry,
    runner: &RunnerState,
    metadata: &MetadataStore,
    review: &ReviewSessionStore,
    app: AppHandle,
) -> Result<(), String> {
    let run_id = request.run_id.clone();

    let Some(harness) = compose_harness_by_id(harness_id) else {
        let message = format!("Unknown harness: {harness_id}");
        emit_error_and_exit(&app, &run_id, &message);
        runner.unregister(&run_id);
        return Err(message);
    };

    // Resolve the working directory through the edit-review gate: for `clone`
    // this builds a sandbox (and records a baseline) and returns its path so
    // the harness edits the copy, not the user's files; for `snapshot` it
    // records a baseline and returns the real root; for `none` it is the real
    // root. The post-run diff (workspace_review_diff) reads the session by
    // run id. See review/mod.rs.
    let cwd = match prepare_edit_guard(
        request.edit_guard,
        &run_id,
        &request.workspace_id,
        registry,
        metadata,
        review,
    ) {
        Ok(path) => path,
        Err(error) => {
            emit_error_and_exit(&app, &run_id, &error);
            runner.unregister(&run_id);
            return Err(error);
        }
    };

    // bob's chat modes collapse to the harness-neutral Ask/Edit: the
    // edit-capable modes map to Edit (so CLI harnesses get their
    // write-permission flags), everything else to Ask.
    let mode = match request.chat_mode {
        ChatMode::Code | ChatMode::Advanced => RunMode::Edit,
        ChatMode::Plan | ChatMode::Ask => RunMode::Ask,
    };

    // Carry the user's picker selections through to the adapter. The
    // adapter maps the subset its CLI supports (claude: model +
    // max-turns; codex: model + effort) and ignores the rest. An empty
    // model string is treated as "unset" so a cleared field falls back
    // to the CLI default rather than passing `--model ""`.
    // The coin budget is bob's alone (no neutral RunTuning field represents it),
    // so it's the one place keyed to the bob id — the registry's own
    // `BOB_HARNESS_ID`, not a Compose constant.
    let mut extra_args = request.extra_args;
    if harness_id == harness::BOB_HARNESS_ID {
        extra_args.push("--max-coins".to_owned());
        extra_args.push(request.max_coins.to_string());
    }

    let tuning = RunTuning {
        model: request
            .model
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .map(str::to_owned),
        effort: request.effort,
        max_turns: request.max_turns,
        // Pass-through: the frontend already resolved per-harness policy
        // (permission mode etc.) into these flags. See harnessExtraArgs in the
        // store. The adapter appends them, overriding its own defaults.
        extra_args,
        // 0.4: structured-output JSON Schema — the bob run path doesn't use it.
        output_schema: None,
        // Per-harness custom instructions (openai-compatible adapter appends
        // them to the system prompt; trimmed-empty is treated as unset).
        extra_instructions: request.extra_instructions.filter(|s| !s.trim().is_empty()),
    };

    let run_request = RunRequest {
        run_id: run_id.clone(),
        prompt: request.prompt,
        cwd: Some(cwd),
        mode,
        tuning,
        // Conversation continuity is still history-in-prompt today; native
        // `--resume` wiring is a follow-up. Fresh session each run for now.
        resume: None,
        // 0.4: image attachments for multimodal models — bob is text-only here.
        attachments: Vec::new(),
    };

    // Bridge a stored API key (bob, OpenRouter, …) into the env var the harness
    // reads it from, just before the run. Credential-free harnesses (Ollama,
    // OpenCode, Claude, Codex) are no-ops. See harness::credentials.
    Credential::of(harness.as_ref()).export_to_env();

    let app_cb = app.clone();
    let runner_inner = Arc::clone(&runner.inner);
    let run_id_cleanup = run_id.clone();
    let callback: RunCallback = Arc::new(move |event: RunEvent| {
        // `run_harness_stream` already emitted Started up front; skip the
        // harness's own to avoid a duplicate.
        if matches!(event, RunEvent::Started { .. }) {
            return;
        }
        // On Exited, deregister so a later cancel doesn't act on a
        // finished run.
        if matches!(event, RunEvent::Exited { .. }) {
            if let Ok(mut inner) = runner_inner.lock() {
                inner.runs.remove(&run_id_cleanup);
            }
        }
        // Map the neutral event into Compose's `ChatEvent`. claude/codex
        // stream their answer as `Text` (no narration concept), and the
        // neutral tier carries no tool-io/session/usage — so those fields
        // come through empty (see `run_event_to_chat`). `None` = a future
        // `#[non_exhaustive]` RunEvent variant Compose doesn't model → skip.
        if let Some(chat) = run_event_to_chat(event) {
            let _ = app_cb.emit(HARNESS_RUN_EVENT, &chat);
        }
    });

    match harness.run(run_request, callback) {
        Ok(handle) => {
            runner.attach_handle(&run_id, handle)?;
            Ok(())
        }
        Err(error) => {
            // `Harness::run` returns the typed `HarnessError`; stringify once
            // for the run-event channel + the command's `Result<_, String>`.
            let message = error.to_string();
            emit_error_and_exit(&app, &run_id, &message);
            runner.unregister(&run_id);
            Err(message)
        }
    }
}

/// Emit a terminal Error + Exited pair on the run-event channel.
fn emit_error_and_exit(app: &AppHandle, run_id: &str, message: &str) {
    let _ = app.emit(
        HARNESS_RUN_EVENT,
        &ChatEvent::Error {
            run_id: run_id.to_owned(),
            message: message.to_owned(),
        },
    );
    let _ = app.emit(
        HARNESS_RUN_EVENT,
        &ChatEvent::Exited {
            run_id: run_id.to_owned(),
            exit_code: None,
            cancelled: false,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    // NOTE: the IPC event wire contract (kind tag + camelCase fields) is
    // Compose's `ChatEvent`, owned + tested in `chat_event.rs`
    // (`chat_event_serializes_kind_tagged_camelcase`, plus the neutral
    // mapper tests). The runner just bridges those onto Tauri's emit pump,
    // so there's nothing event-shape-specific left to assert here.

    #[test]
    fn cancel_unknown_run_returns_error() {
        let runner = RunnerState::default();
        assert!(runner
            .cancel("run-missing")
            .unwrap_err()
            .contains("not active"));
    }
}
