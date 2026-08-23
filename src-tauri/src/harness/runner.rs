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
use crate::harness::registry::compose_harness_by_id;
use crate::harness::{ApprovalMode, ChatMode};
use crate::review::{prepare_edit_guard, EditGuard, ReviewSessionStore};
use crate::workspace::WorkspaceRegistry;
use crate::harness::orphan_runs;
use harness::{ReasoningEffort, RunCallback, RunControl, RunEvent, RunMode, RunRequest, RunTuning};
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
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
    pub prompt: String,
    pub run_id: String,
    pub workspace_id: String,
    /// Which harness to run; every id
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
    /// Absolute path to the agent's executable, pinning the run to a specific
    /// vetted binary instead of resolving the bare CLI name on PATH (the
    /// Runtimes panel's "Set explicit path"). Threaded to the adapter via
    /// `RunTuning.binary_path`; the CLI adapters spawn it, the
    /// `openai-compatible` adapter ignores it. Omitted/empty → PATH resolution.
    #[serde(default)]
    pub binary_path: Option<String>,
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
    /// App data dir, set once at boot. The live runs' pids are mirrored to a
    /// file here so a child orphaned by a hard crash can be killed on the next
    /// launch (see [`orphan_runs`]). `None` until set — pid bookkeeping is then
    /// a no-op (cancellation still works).
    data_dir: Option<PathBuf>,
}

impl RunnerInner {
    /// Mirror the current live pids to the orphan-tracking file. Called after
    /// any change to `runs` (a child attaches, or a run ends).
    fn persist_pids(&self) {
        let Some(dir) = self.data_dir.as_deref() else {
            return;
        };
        let pids: BTreeMap<String, u32> = self
            .runs
            .iter()
            .filter_map(|(id, run)| {
                let pid = run.pid.load(Ordering::SeqCst);
                (pid != 0).then(|| (id.clone(), pid))
            })
            .collect();
        orphan_runs::write(dir, &pids);
    }
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
    /// The child's OS pid once spawned (0 = none yet, or a process-less
    /// direct-model run). Mirrored to the orphan-tracking file so a crash
    /// orphan can be reaped next launch.
    pid: AtomicU32,
}

impl ActiveRun {
    fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
            handle: Mutex::new(None),
            pid: AtomicU32::new(0),
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

    /// Cancel every in-flight run — used on app exit so an agent child doesn't
    /// orphan (and keep editing files) once the window is gone. Best-effort:
    /// each child is signalled, and any that ignores it is reaped by the
    /// orphan sweep on the next launch.
    pub fn cancel_all(&self) {
        let Ok(inner) = self.inner.lock() else {
            return;
        };
        for run in inner.runs.values() {
            run.cancelled.store(true, Ordering::SeqCst);
            if let Ok(guard) = run.handle.lock() {
                if let Some(handle) = guard.as_ref() {
                    let _ = handle.cancel();
                }
            }
        }
    }

    /// Point pid bookkeeping at the app data dir (once, at boot). Until set,
    /// recording live pids is a no-op.
    pub fn set_data_dir(&self, dir: PathBuf) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.data_dir = Some(dir);
        }
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
        // Record the child's pid before the handle moves into the slot, then
        // mirror the live set to disk so a crash orphan can be reaped on the
        // next launch. A process-less run (direct-model adapter) reports None.
        let pid = handle.pid().unwrap_or(0);
        if let Ok(mut guard) = run.handle.lock() {
            *guard = Some(handle);
        }
        run.pid.store(pid, Ordering::SeqCst);
        inner.persist_pids();
        Ok(())
    }

    fn unregister(&self, run_id: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.runs.remove(run_id);
            inner.persist_pids();
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
    let tuning = tuning_for(&request);

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
        // finished run, and drop its pid from the orphan-tracking file.
        if matches!(event, RunEvent::Exited { .. }) {
            if let Ok(mut inner) = runner_inner.lock() {
                inner.runs.remove(&run_id_cleanup);
                inner.persist_pids();
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

    // `start` is the push form: events go straight onto the Tauri event
    // stream from the callback, so a channel would be a wasted hop.
    match harness.start(run_request, callback) {
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
/// The adapter-facing knobs, built from one request.
///
/// Separated from [`run_via_harness`] because it is a set of decisions and the
/// rest of that function is a spawn: every "trimmed-empty means unset" rule
/// here was unreachable from a test while it sat inside a function that starts
/// a process. Each one has a visible failure — a cleared model field becoming
/// `--model ""`, or an empty override becoming a path the spawn cannot find.
fn tuning_for(request: &HarnessRunRequest) -> RunTuning {
    RunTuning {
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
        extra_args: request.extra_args.clone(),
        // 0.4: structured-output JSON Schema — the bob run path doesn't use it.
        output_schema: None,
        // Per-harness custom instructions (openai-compatible adapter appends
        // them to the system prompt; trimmed-empty is treated as unset).
        extra_instructions: request.extra_instructions.clone().filter(|s| !s.trim().is_empty()),
        // Explicit binary override — the CLI adapters spawn this path instead of
        // resolving the bare name on PATH (trimmed-empty is treated as unset).
        binary_path: request
            .binary_path
            .clone()
            .map(|p| p.trim().to_owned())
            .filter(|p| !p.is_empty())
            .map(std::path::PathBuf::from),
    }
}

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

    /// A stand-in child. Records that it was told to stop and reports whatever
    /// pid the test wants, so the registry's bookkeeping can be checked without
    /// spawning anything.
    struct FakeChild {
        cancelled: Arc<AtomicBool>,
        pid: Option<u32>,
    }

    impl FakeChild {
        fn boxed(pid: Option<u32>) -> (Box<dyn RunControl>, Arc<AtomicBool>) {
            let cancelled = Arc::new(AtomicBool::new(false));
            let child = FakeChild { cancelled: Arc::clone(&cancelled), pid };
            (Box::new(child), cancelled)
        }
    }

    impl RunControl for FakeChild {
        fn cancel(&self) -> Result<(), harness::Error> {
            self.cancelled.store(true, Ordering::SeqCst);
            Ok(())
        }
        fn was_cancelled(&self) -> bool {
            self.cancelled.load(Ordering::SeqCst)
        }
        fn pid(&self) -> Option<u32> {
            self.pid
        }
    }

    /// The orphan file, by name. The coupling is deliberate: this file is read
    /// by the *next* launch, so renaming it does not fail anything here — it
    /// silently strands every file a previous version wrote, and the orphans
    /// they name are never reaped.
    fn recorded_pids(dir: &std::path::Path) -> BTreeMap<String, u32> {
        let path = dir.join("active-runs.json");
        let Ok(text) = std::fs::read_to_string(path) else {
            return BTreeMap::new();
        };
        serde_json::from_str(&text).unwrap_or_default()
    }

    fn request_with(
        model: Option<&str>,
        instructions: Option<&str>,
        binary: Option<&str>,
    ) -> HarnessRunRequest {
        HarnessRunRequest {
            approval_mode: ApprovalMode::Default,
            chat_mode: ChatMode::Ask,
            context_file_paths: Vec::new(),
            prompt: "hi".to_owned(),
            run_id: "r1".to_owned(),
            workspace_id: "ws".to_owned(),
            harness_id: default_harness_id(),
            model: model.map(str::to_owned),
            effort: None,
            max_turns: None,
            edit_guard: EditGuard::None,
            extra_args: Vec::new(),
            extra_instructions: instructions.map(str::to_owned),
            binary_path: binary.map(str::to_owned),
        }
    }

    #[test]
    fn a_cleared_field_is_unset_rather_than_an_empty_value() {
        // Settings writes "" when the user clears a field. Passed through, the
        // adapter sends `--model ""` and the CLI rejects it, or spawns an empty
        // binary path and fails with "No such file" — both of which read as a
        // broken app rather than a blank setting.
        let blank = tuning_for(&request_with(Some("   "), Some(" \n "), Some("  ")));
        assert_eq!(blank.model, None, "a whitespace model is unset");
        assert_eq!(blank.extra_instructions, None, "whitespace instructions are unset");
        assert_eq!(blank.binary_path, None, "a whitespace path is unset");

        let empty = tuning_for(&request_with(Some(""), Some(""), Some("")));
        assert_eq!((empty.model, empty.extra_instructions, empty.binary_path), (None, None, None));
    }

    #[test]
    fn a_real_value_is_trimmed_and_kept() {
        // The other half: trimming must not become dropping. A pasted model id
        // with a trailing space is still a model id.
        let tuning = tuning_for(&request_with(
            Some("  opus  "),
            Some("  be terse  "),
            Some("  /usr/local/bin/claude  "),
        ));
        assert_eq!(tuning.model.as_deref(), Some("opus"));
        assert_eq!(
            tuning.extra_instructions.as_deref(),
            Some("  be terse  "),
            "instructions keep their shape; only emptiness is checked",
        );
        assert_eq!(
            tuning.binary_path.as_deref(),
            Some(std::path::Path::new("/usr/local/bin/claude")),
        );
    }

    #[test]
    fn an_omitted_harness_id_falls_back_to_the_registry_default() {
        // The field is `#[serde(default)]`, so a request without one has to
        // land on a harness that exists. An empty string resolves to nothing
        // and the run fails with "Unknown assistant: ".
        let id = default_harness_id();
        assert!(!id.is_empty(), "a default has to name something");
        assert_eq!(id, harness::DEFAULT_HARNESS_ID);
        assert!(
            crate::harness::registry::compose_harness_by_id(&id).is_some(),
            "{id} is not in Compose's registry",
        );
    }

    #[test]
    fn cancel_unknown_run_returns_error() {
        let runner = RunnerState::default();
        assert!(runner
            .cancel("run-missing")
            .unwrap_err()
            .contains("not active"));
    }

    #[test]
    fn stop_before_the_child_exists_still_stops_the_child() {
        // The window this registry exists for: the user can hit Stop while the
        // run is still resolving a workspace or waiting on a keychain prompt,
        // long before a process exists. If the flag did not survive to the
        // attach, the agent would spawn *after* being cancelled and start
        // editing files nobody asked it to touch.
        let runner = RunnerState::default();
        let token = runner.register_pending("r1".to_owned()).expect("register");

        runner.cancel("r1").expect("cancel a pending run");
        assert!(token.load(Ordering::SeqCst), "the preparation step sees the intent");

        let (child, child_cancelled) = FakeChild::boxed(Some(4242));
        runner.attach_handle("r1", child).expect("attach");
        assert!(child_cancelled.load(Ordering::SeqCst), "the late child is stopped");
    }

    #[test]
    fn stop_after_the_child_exists_signals_it() {
        let runner = RunnerState::default();
        runner.register_pending("r1".to_owned()).expect("register");
        let (child, child_cancelled) = FakeChild::boxed(Some(1));
        runner.attach_handle("r1", child).expect("attach");

        runner.cancel("r1").expect("cancel");
        assert!(child_cancelled.load(Ordering::SeqCst));
    }

    #[test]
    fn attaching_to_a_run_that_already_ended_does_not_leak_it() {
        // The exit pump deregisters a run when it finishes. A handle arriving
        // after that has nowhere to live, and simply dropping it leaves the
        // process running with nothing holding its id.
        let runner = RunnerState::default();
        let (child, child_cancelled) = FakeChild::boxed(Some(7));
        runner.attach_handle("never-registered", child).expect("attach is not an error");
        assert!(child_cancelled.load(Ordering::SeqCst), "an unattachable child is stopped");
    }

    #[test]
    fn quitting_stops_every_run_not_just_the_first() {
        // On app exit each child is signalled. A loop that stopped early would
        // leave agents editing the user's files after the window is gone —
        // and the survivors are only reaped on the *next* launch.
        let runner = RunnerState::default();
        let mut flags = Vec::new();
        for id in ["a", "b", "c"] {
            runner.register_pending(id.to_owned()).expect("register");
            let (child, cancelled) = FakeChild::boxed(Some(1));
            runner.attach_handle(id, child).expect("attach");
            flags.push((id, cancelled));
        }

        runner.cancel_all();

        for (id, cancelled) in flags {
            assert!(cancelled.load(Ordering::SeqCst), "{id} was left running");
        }
    }

    #[test]
    fn live_pids_are_mirrored_to_disk_and_cleared_when_a_run_ends() {
        // The file is the only thing that survives a hard crash, so it is what
        // lets the next launch reap an orphaned agent. Recording a pid that is
        // no longer live, or missing one that is, both break that sweep.
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = RunnerState::default();
        runner.set_data_dir(dir.path().to_path_buf());

        runner.register_pending("r1".to_owned()).expect("register");
        let (child, _) = FakeChild::boxed(Some(4242));
        runner.attach_handle("r1", child).expect("attach");

        assert_eq!(recorded_pids(dir.path()).get("r1"), Some(&4242));

        runner.unregister("r1");
        assert!(recorded_pids(dir.path()).is_empty(), "a finished run is not an orphan");
    }

    #[test]
    fn a_run_with_no_process_records_no_pid() {
        // The direct-model adapter aborts an HTTP stream; there is no child to
        // reap. Writing 0 would have the next launch inspect pid 0.
        let dir = tempfile::tempdir().expect("tempdir");
        let runner = RunnerState::default();
        runner.set_data_dir(dir.path().to_path_buf());

        runner.register_pending("r1".to_owned()).expect("register");
        let (child, _) = FakeChild::boxed(None);
        runner.attach_handle("r1", child).expect("attach");

        assert!(recorded_pids(dir.path()).is_empty(), "nothing to reap, nothing recorded");
    }

    #[test]
    fn pid_bookkeeping_without_a_data_dir_is_a_no_op_not_a_failure() {
        // `set_data_dir` happens at boot; anything before it must still run.
        let runner = RunnerState::default();
        runner.register_pending("r1".to_owned()).expect("register");
        let (child, cancelled) = FakeChild::boxed(Some(9));
        runner.attach_handle("r1", child).expect("attach without a data dir");

        runner.cancel("r1").expect("cancel still works");
        assert!(cancelled.load(Ordering::SeqCst));
    }
}
