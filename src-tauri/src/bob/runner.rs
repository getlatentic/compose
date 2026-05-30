//! Tauri-side bob CLI runner.
//!
//! The IPC contract with the front-end (event names, payload
//! shapes, command signatures) is unchanged from before the
//! `bob-rs` extraction. What changed is the *implementation*:
//! the actual spawn + stdout/stderr/exit handling now lives in
//! `bob_rs::spawn_bob_raw`, the same function the
//! browser-preview HTTP server calls.
//!
//! What remains here:
//!   * Workspace lookup + Bob-command prep (`prepare_bob_spawn`)
//!     — Tauri-specific because it knows about
//!     `WorkspaceRegistry` and `build_bob_command`'s richer
//!     `BobRunMode` enum.
//!   * Run-id keyed `BobRunnerState` so `cancel_harness_run` can find
//!     the right handle.
//!   * Bridging `bob_rs::ProcessEvent` to Tauri's `app.emit`
//!     pump on the existing `HARNESS_RUN_EVENT` channel name.
//!
//! Net effect: the desktop build and the browser preview now
//! execute byte-identical spawn + stream code, with each
//! transport supplying just its own glue (Tauri event emit /
//! axum SSE).

use crate::bob::locator::{resolve_bob_executable, BobExecutable};
use crate::bob::{build_bob_command, BobApprovalMode, BobChatMode, BobCommandRequest, BobRunMode};
use crate::settings::load_bob_api_key;
use crate::workspace::WorkspaceRegistry;
use bob_rs::{spawn_bob_raw, ProcessEvent as CoreEvent, InstallEvent};
use agent_harness::normalize_bob_event;
use agent_harness::harness_by_id;
use agent_harness::{
    HarnessReadiness, InstallCallback, ReasoningEffort, RunCallback, RunControl, RunEvent, RunMode,
    RunRequest, RunTuning,
};
use serde::Deserialize;
use tauri::ipc::Channel;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub const HARNESS_RUN_EVENT: &str = "harness_run";

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HarnessRunRequest {
    pub approval_mode: BobApprovalMode,
    pub chat_mode: BobChatMode,
    #[serde(default)]
    pub context_file_paths: Vec<String>,
    pub max_coins: u32,
    pub prompt: String,
    pub run_id: String,
    pub workspace_id: String,
    /// Which harness to run. Defaults to `"bob"` so existing callers
    /// (and the chat panel until the H5 picker lands) keep hitting
    /// bob's richer Tauri path. Other ids route through the
    /// `compose_harness` registry.
    #[serde(default = "default_harness_id")]
    pub harness_id: String,
    /// Per-harness run tuning the Settings picker exposes. Only the
    /// CLI harnesses (claude/codex) honor these via `run_via_harness`;
    /// the bob branch keeps its own chat-mode / coin controls and
    /// ignores them. All optional — omitted → the CLI's own defaults.
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub effort: Option<ReasoningEffort>,
    #[serde(default)]
    pub max_turns: Option<u32>,
}

fn default_harness_id() -> String {
    agent_harness::DEFAULT_HARNESS_ID.to_owned()
}

// The IPC event shape is now `agent_harness::RunEvent` — the
// normalized stream every harness emits (Started / Text /
// SuggestedEdits / Activity / Error / Exited). bob's raw
// stream-json stdout is parsed into those by
// `normalize_bob_event` at the bridge below, so the front-end
// consumes one harness-neutral vocabulary instead of parsing
// bob's wire format itself. (The old src-tauri-local `BobRunEvent`
// type carried `workspace_id` on Started; the front-end correlates by
// the per-run subscription closure, not that field, so it's gone.)

#[derive(Default)]
pub struct BobRunnerState {
    inner: Arc<Mutex<BobRunnerInner>>,
}

#[derive(Default)]
struct BobRunnerInner {
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

impl BobRunnerState {
    pub fn cancel(&self, run_id: &str) -> Result<(), String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "bob runner lock was poisoned".to_owned())?;
        let Some(run) = inner.runs.get(run_id) else {
            return Err("run is not active".to_owned());
        };
        // Flip the flag first — this lets a still-preparing
        // spawn bail out the moment its blocking work returns.
        run.cancelled.store(true, Ordering::SeqCst);
        // If the child is already alive, signal it too.
        if let Ok(guard) = run.handle.lock() {
            if let Some(handle) = guard.as_ref() {
                return handle.cancel();
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
            .map_err(|_| "bob runner lock was poisoned".to_owned())?;
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
            .map_err(|_| "bob runner lock was poisoned".to_owned())?;
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
    runner: State<'_, BobRunnerState>,
    app: AppHandle,
) -> Result<(), String> {
    // Register the run as "pending" up front. From this moment
    // forward, `cancel_harness_run(run_id)` finds an entry and can
    // flip the cancellation token — even if we're still blocked
    // inside the OS keychain prompt during `prepare_bob_spawn`.
    let cancel_token = runner.register_pending(request.run_id.clone())?;
    let run_id = request.run_id.clone();

    // Emit Started immediately so the front-end can flip the
    // chat-thread state to "starting" before the (potentially
    // slow) preparation phase. Doing this even when the user
    // ends up cancelling is fine — they'll get the matching
    // Exited{cancelled:true} a moment later.
    let _ = app.emit(
        HARNESS_RUN_EVENT,
        &RunEvent::Started {
            run_id: run_id.clone(),
        },
    );

    // Defensive: bail if the user already pressed Stop in the
    // microsecond between starting and now. (Mostly relevant
    // when prepare_bob_spawn is itself fast and the second-IPC
    // window is real.)
    if cancel_token.load(Ordering::SeqCst) {
        let _ = app.emit(
            HARNESS_RUN_EVENT,
            &RunEvent::Exited {
                run_id: run_id.clone(),
                exit_code: None,
                cancelled: true,
            },
        );
        runner.unregister(&run_id);
        return Ok(());
    }

    // Route by harness. bob keeps its richer Tauri path below
    // (locator + workspace-aware argv + attached context files); any
    // other harness goes through the generic `compose_harness` registry.
    let harness_id = if request.harness_id.trim().is_empty() {
        agent_harness::DEFAULT_HARNESS_ID.to_owned()
    } else {
        request.harness_id.clone()
    };
    if harness_id != agent_harness::DEFAULT_HARNESS_ID {
        return run_via_harness(&harness_id, request, &registry, &runner, app);
    }

    // Blocking work. May trigger the macOS Keychain prompt on
    // first key access for this binary. This command is declared
    // `#[tauri::command(async)]`, so the whole body runs on a
    // Tauri worker thread, NOT the main UI thread — the native
    // window stays responsive while we block here. `cancel_harness_run`
    // is likewise `(async)`, so it runs on its own worker and can
    // flip the cancel flag we check below even while we're parked
    // in the keychain prompt.
    let prepared = match prepare_bob_spawn(&request, &registry) {
        Ok(p) => p,
        Err(error) => {
            let _ = app.emit(
                HARNESS_RUN_EVENT,
                &RunEvent::Error {
                    run_id: run_id.clone(),
                    message: error.clone(),
                },
            );
            let _ = app.emit(
                HARNESS_RUN_EVENT,
                &RunEvent::Exited {
                    run_id: run_id.clone(),
                    exit_code: None,
                    cancelled: cancel_token.load(Ordering::SeqCst),
                },
            );
            runner.unregister(&run_id);
            return Err(error);
        }
    };

    // Did the user click Stop while we were waiting on the
    // keychain prompt? Honor it before spawning anything.
    if cancel_token.load(Ordering::SeqCst) {
        let _ = app.emit(
            HARNESS_RUN_EVENT,
            &RunEvent::Exited {
                run_id: run_id.clone(),
                exit_code: None,
                cancelled: true,
            },
        );
        runner.unregister(&run_id);
        return Ok(());
    }

    spawn_via_core(prepared, &runner, app)
}

#[tauri::command(async)]
pub fn cancel_harness_run(run_id: String, runner: State<'_, BobRunnerState>) -> Result<(), String> {
    runner.cancel(&run_id)
}

#[derive(Debug)]
pub struct PreparedSpawn {
    pub api_key: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub program: String,
    pub run_id: String,
    pub workspace_id: String,
}

pub fn prepare_bob_spawn(
    request: &HarnessRunRequest,
    registry: &WorkspaceRegistry,
) -> Result<PreparedSpawn, String> {
    prepare_bob_spawn_with_dependencies(request, registry, load_bob_api_key, resolve_bob_executable)
}

fn prepare_bob_spawn_with_dependencies<A, B>(
    request: &HarnessRunRequest,
    registry: &WorkspaceRegistry,
    api_key_loader: A,
    bob_resolver: B,
) -> Result<PreparedSpawn, String>
where
    A: FnOnce() -> Result<String, String>,
    B: FnOnce() -> Result<BobExecutable, crate::bob::locator::BobExecutableError>,
{
    if request.run_id.trim().is_empty() {
        return Err("run id cannot be blank".to_owned());
    }
    if request.prompt.trim().is_empty() {
        return Err("prompt is required".to_owned());
    }

    let cwd = registry.workspace_root(&request.workspace_id)?;
    let api_key = api_key_loader()?;
    let bob_executable = bob_resolver().map_err(|error| error.to_string())?;

    let preview = build_bob_command(&BobCommandRequest {
        approval_mode: request.approval_mode,
        chat_mode: request.chat_mode,
        context_file_paths: request.context_file_paths.clone(),
        max_coins: request.max_coins,
        mode: BobRunMode::StreamJson,
        prompt: Some(request.prompt.clone()),
        workspace_id: Some(request.workspace_id.clone()),
    })
    .map_err(|error| error.to_string())?;

    Ok(PreparedSpawn {
        api_key,
        args: preview.args,
        cwd,
        program: bob_executable.path.display().to_string(),
        run_id: request.run_id.clone(),
        workspace_id: request.workspace_id.clone(),
    })
}

/// Spawn via `bob-rs` and wire the resulting event stream to
/// Tauri's `app.emit`. The Started event is re-emitted with the
/// extra `workspace_id` field that bob-rs doesn't carry; the
/// rest map 1:1.
fn spawn_via_core(
    prepared: PreparedSpawn,
    runner: &BobRunnerState,
    app: AppHandle,
) -> Result<(), String> {
    let PreparedSpawn { api_key, args, cwd, program, run_id, workspace_id } = prepared;

    let app_for_cb = app.clone();
    let runner_inner_clone = Arc::clone(&runner.inner);
    let run_id_for_cleanup = run_id.clone();

    // Bridge bob-rs's raw event stream to Tauri's IPC events as
    // the harness-neutral `agent_harness::RunEvent`. Each core event
    // is run through `normalize_bob_event`, which parses bob's
    // stream-json stdout into Text / SuggestedEdits / Activity and
    // passes lifecycle events through. We suppress the core
    // `Started` (run_harness_stream already emitted `RunEvent::Started`
    // up front), and on `Exited` deregister from the runner state so
    // a later cancel doesn't try to SIGTERM a dead PID.
    let callback = move |event: CoreEvent| {
        if matches!(event, CoreEvent::Started { .. }) {
            return; // emitted explicitly up front
        }
        if matches!(event, CoreEvent::Exited { .. }) {
            if let Ok(mut inner) = runner_inner_clone.lock() {
                inner.runs.remove(&run_id_for_cleanup);
            }
        }
        for normalized in normalize_bob_event(event) {
            let _ = app_for_cb.emit(HARNESS_RUN_EVENT, &normalized);
        }
    };

    // workspace_id is no longer part of the wire event; the
    // front-end correlates events to a workspace via the per-run
    // subscription closure, not a field on the event.
    let _ = workspace_id;

    let handle = spawn_bob_raw(
        PathBuf::from(&program),
        args,
        api_key,
        cwd,
        run_id.clone(),
        callback,
    )?;

    // The run is already registered as "pending" from the
    // run_harness_stream entry point. Attach the live handle so
    // cancel_harness_run can SIGTERM the actual child. If the user
    // cancelled while we were preparing, `attach_handle`
    // detects that and SIGTERMs the just-spawned child rather
    // than leaving a zombie.
    runner.attach_handle(&run_id, Box::new(handle))?;
    Ok(())
}

/// Run a non-bob harness through the `compose_harness` registry. bob
/// keeps its richer Tauri path in `run_harness_stream` (locator +
/// workspace-aware argv + attached context files); this handles
/// Claude Code, Codex, and any future adapter generically — resolve
/// the harness, build a neutral `RunRequest`, and stream its
/// normalized `RunEvent`s on the same IPC channel + runner state, so
/// cancellation and run bookkeeping work identically.
fn run_via_harness(
    harness_id: &str,
    request: HarnessRunRequest,
    registry: &WorkspaceRegistry,
    runner: &BobRunnerState,
    app: AppHandle,
) -> Result<(), String> {
    let run_id = request.run_id.clone();

    let Some(harness) = harness_by_id(harness_id) else {
        let message = format!("Unknown harness: {harness_id}");
        emit_error_and_exit(&app, &run_id, &message);
        runner.unregister(&run_id);
        return Err(message);
    };

    let cwd = match registry.workspace_root(&request.workspace_id) {
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
        BobChatMode::Code | BobChatMode::Advanced => RunMode::Edit,
        BobChatMode::Plan | BobChatMode::Ask => RunMode::Ask,
    };

    // Carry the user's picker selections through to the adapter. The
    // adapter maps the subset its CLI supports (claude: model +
    // max-turns; codex: model + effort) and ignores the rest. An empty
    // model string is treated as "unset" so a cleared field falls back
    // to the CLI default rather than passing `--model ""`.
    let tuning = RunTuning {
        model: request
            .model
            .as_deref()
            .map(str::trim)
            .filter(|m| !m.is_empty())
            .map(str::to_owned),
        effort: request.effort,
        max_turns: request.max_turns,
    };

    let run_request = RunRequest {
        run_id: run_id.clone(),
        prompt: request.prompt,
        cwd: Some(cwd),
        mode,
        tuning,
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
        // finished run.
        if matches!(event, RunEvent::Exited { .. }) {
            if let Ok(mut inner) = runner_inner.lock() {
                inner.runs.remove(&run_id_cleanup);
            }
        }
        let _ = app_cb.emit(HARNESS_RUN_EVENT, &event);
    });

    match harness.run(run_request, callback) {
        Ok(handle) => {
            runner.attach_handle(&run_id, handle)?;
            Ok(())
        }
        Err(error) => {
            emit_error_and_exit(&app, &run_id, &error);
            runner.unregister(&run_id);
            Err(error)
        }
    }
}

/// Emit a terminal Error + Exited pair on the run-event channel.
fn emit_error_and_exit(app: &AppHandle, run_id: &str, message: &str) {
    let _ = app.emit(
        HARNESS_RUN_EVENT,
        &RunEvent::Error {
            run_id: run_id.to_owned(),
            message: message.to_owned(),
        },
    );
    let _ = app.emit(
        HARNESS_RUN_EVENT,
        &RunEvent::Exited {
            run_id: run_id.to_owned(),
            exit_code: None,
            cancelled: false,
        },
    );
}

/// `harness_list` — the harness catalog for the Settings picker
/// (id, display name, description, whether it needs an install).
#[tauri::command(async)]
pub fn harness_list() -> Result<Vec<agent_harness::HarnessInfo>, String> {
    Ok(agent_harness::harness_catalog())
}

/// `harness_readiness` — probe one harness (installed / version /
/// auth / error). Drives the picker's "Ready ✓" vs "Set up" state.
/// May shell out (`<bin> --version`); runs `(async)` so it never
/// blocks the UI thread.
#[tauri::command(async)]
pub fn harness_readiness(harness_id: String) -> Result<HarnessReadiness, String> {
    let harness =
        harness_by_id(&harness_id).ok_or_else(|| format!("Unknown harness: {harness_id}"))?;
    Ok(harness.readiness())
}

/// `harness_install` — stream a harness's one-time install over a
/// Tauri `Channel`, mirroring `settings_install_bob` but resolved by
/// id so any harness's `install()` is reachable from the picker.
#[tauri::command(async)]
pub fn harness_install(harness_id: String, on_event: Channel<InstallEvent>) -> Result<(), String> {
    let harness =
        harness_by_id(&harness_id).ok_or_else(|| format!("Unknown harness: {harness_id}"))?;
    let callback: InstallCallback = std::sync::Arc::new(move |event| {
        let _ = on_event.send(event);
    });
    harness.install(callback)
}

/// `harness_login` — stream a harness's interactive sign-in (its CLI's
/// own OAuth) over a Tauri `Channel`, mirroring `harness_install`. The
/// flow opens the user's browser; `Done { ok }` reports success so the
/// picker can re-probe readiness. `(async)` so the blocking login wait
/// runs on a worker thread, never the UI thread (see ipc-guide.md).
#[tauri::command(async)]
pub fn harness_login(harness_id: String, on_event: Channel<InstallEvent>) -> Result<(), String> {
    let harness =
        harness_by_id(&harness_id).ok_or_else(|| format!("Unknown harness: {harness_id}"))?;
    let callback: InstallCallback = std::sync::Arc::new(move |event| {
        let _ = on_event.send(event);
    });
    harness.login(callback)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workspace::WorkspaceRegistry;
    use tempfile::tempdir;

    #[test]
    fn prepare_rejects_blank_run_id() {
        let dir = tempdir().expect("tempdir");
        let registry = WorkspaceRegistry::default();
        let list = registry
            .add(dir.path().to_string_lossy().to_string())
            .expect("add");
        let workspace_id = list.workspaces[0].id.clone();

        let request = HarnessRunRequest {
            approval_mode: BobApprovalMode::Default,
            chat_mode: BobChatMode::Plan,
            context_file_paths: Vec::new(),
            max_coins: 200,
            prompt: "hi".to_owned(),
            run_id: "  ".to_owned(),
            workspace_id,
            harness_id: "bob".to_owned(),
            model: None,
            effort: None,
            max_turns: None,
        };

        assert!(prepare_bob_spawn(&request, &registry)
            .unwrap_err()
            .contains("run id"));
    }

    #[test]
    fn prepare_rejects_blank_prompt() {
        let dir = tempdir().expect("tempdir");
        let registry = WorkspaceRegistry::default();
        let list = registry
            .add(dir.path().to_string_lossy().to_string())
            .expect("add");
        let workspace_id = list.workspaces[0].id.clone();

        let request = HarnessRunRequest {
            approval_mode: BobApprovalMode::Default,
            chat_mode: BobChatMode::Plan,
            context_file_paths: Vec::new(),
            max_coins: 200,
            prompt: "   ".to_owned(),
            run_id: "run-1".to_owned(),
            workspace_id,
            harness_id: "bob".to_owned(),
            model: None,
            effort: None,
            max_turns: None,
        };

        assert!(prepare_bob_spawn(&request, &registry)
            .unwrap_err()
            .contains("prompt"));
    }

    #[test]
    fn prepare_rejects_unknown_workspace() {
        let registry = WorkspaceRegistry::default();
        let request = HarnessRunRequest {
            approval_mode: BobApprovalMode::Default,
            chat_mode: BobChatMode::Plan,
            context_file_paths: Vec::new(),
            max_coins: 200,
            prompt: "hi".to_owned(),
            run_id: "run-1".to_owned(),
            workspace_id: "workspace-missing".to_owned(),
            harness_id: "bob".to_owned(),
            model: None,
            effort: None,
            max_turns: None,
        };

        assert!(prepare_bob_spawn(&request, &registry)
            .unwrap_err()
            .contains("workspace"));
    }

    // NOTE: the IPC event wire contract (kind tag + camelCase fields)
    // is now owned + tested by `harness_bob`
    // (`run_event_serializes_with_kind_and_camelcase`). The runner
    // just forwards `agent_harness::RunEvent`, so there's nothing
    // src-tauri-specific left to assert about the event shape here.

    #[test]
    fn cancel_unknown_run_returns_error() {
        let runner = BobRunnerState::default();
        assert!(runner
            .cancel("run-missing")
            .unwrap_err()
            .contains("not active"));
    }

    #[test]
    fn prepare_uses_resolved_bob_executable_path() {
        let dir = tempdir().expect("tempdir");
        let registry = WorkspaceRegistry::default();
        let list = registry
            .add(dir.path().to_string_lossy().to_string())
            .expect("add");
        let workspace_id = list.workspaces[0].id.clone();
        let request = HarnessRunRequest {
            approval_mode: BobApprovalMode::Default,
            chat_mode: BobChatMode::Plan,
            context_file_paths: Vec::new(),
            max_coins: 200,
            prompt: "hi".to_owned(),
            run_id: "run-1".to_owned(),
            workspace_id,
            harness_id: "bob".to_owned(),
            model: None,
            effort: None,
            max_turns: None,
        };

        let prepared = prepare_bob_spawn_with_dependencies(
            &request,
            &registry,
            || Ok("api-key".to_owned()),
            || {
                Ok(BobExecutable {
                    path: "/Users/dev/.nvm/versions/node/v24.13.0/bin/bob".into(),
                })
            },
        )
        .expect("prepared");

        assert_eq!(
            prepared.program,
            "/Users/dev/.nvm/versions/node/v24.13.0/bin/bob"
        );
        assert_eq!(prepared.api_key, "api-key");
        assert!(prepared.args.contains(&"--output-format".to_owned()));
    }
}
