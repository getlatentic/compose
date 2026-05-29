//! Spawn the bob CLI and stream its JSONL output.
//!
//! Both `bob-api` (browser preview HTTP) and `src-tauri` (desktop
//! IPC) consume this. The shape mirrors what each transport
//! already does — the only difference is what the closure does
//! with the events (send over a channel, push to a tokio mpsc,
//! call `app.emit`, etc).
//!
//! Cancellation is the wrinkle: the run path needs to free
//! BobShell coins when the user closes the browser tab or hits
//! "stop" mid-stream. We expose a `BobRunHandle::cancel()` that
//! sends SIGTERM (with a SIGKILL fallback) and flips an atomic
//! `cancelled` flag the reader threads use to short-circuit.

use crate::keychain::resolve_api_key;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

// --- Wire shapes (re-used by both transports) -----------------------

/// Bob chat mode CLI flag. `--chat-mode <value>` accepts the
/// snake_case forms below.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BobChatMode {
    Plan,
    Code,
    Advanced,
    Ask,
}

impl BobChatMode {
    pub fn as_cli_value(self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Code => "code",
            Self::Advanced => "advanced",
            Self::Ask => "ask",
        }
    }
}

/// Bob's approval flow. `default` prompts the user via bob's UI;
/// `yolo` skips prompts. We only use `default` and `yolo` today
/// (the legacy `auto_edit` mode kept for back-compat with the
/// existing Tauri command surface).
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BobApprovalMode {
    Default,
    AutoEdit,
    Yolo,
}

impl BobApprovalMode {
    pub fn as_cli_value(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::AutoEdit => "auto_edit",
            Self::Yolo => "yolo",
        }
    }
}

/// Options for a single bob run. Built by both the axum endpoint
/// (from JSON body) and the Tauri command (from invoke args).
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunBobOptions {
    pub prompt: String,
    #[serde(default = "default_chat_mode")]
    pub chat_mode: BobChatMode,
    #[serde(default = "default_approval_mode")]
    pub approval_mode: BobApprovalMode,
    #[serde(default = "default_max_coins")]
    pub max_coins: u32,
    /// Working directory the bob process runs in. Defaults to the
    /// caller's cwd. For workspace-scoped runs, pass the workspace
    /// path so bob's tool calls land inside that workspace.
    pub cwd: Option<PathBuf>,
    /// Override the bob executable path. Mainly for tests + when
    /// the caller has already resolved bob (e.g. Tauri's locator).
    /// Defaults to `bob` on PATH.
    #[serde(default)]
    pub bob_executable: Option<PathBuf>,
}

fn default_chat_mode() -> BobChatMode { BobChatMode::Ask }
fn default_approval_mode() -> BobApprovalMode { BobApprovalMode::Default }
fn default_max_coins() -> u32 { 30 }

/// Events emitted to the caller's callback during a bob run.
/// JSON-tagged so axum SSE and Tauri Channel render identical
/// payloads on the wire.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BobRunEvent {
    /// First event. Sent before the child has produced any
    /// output so the UI can show a "thinking…" state.
    Started { run_id: String },
    /// Raw stdout line. Bob emits one JSON object per line in
    /// `--output-format stream-json` mode. The caller parses.
    Stdout { run_id: String, line: String },
    /// Raw stderr line. Warnings + the occasional error.
    Stderr { run_id: String, line: String },
    /// Spawn / IO failure. Terminal — followed by `Exited`.
    Error { run_id: String, message: String },
    /// Process exited. Always sent exactly once at the end.
    Exited {
        run_id: String,
        exit_code: Option<i32>,
        /// True iff `cancel()` was called before exit.
        cancelled: bool,
    },
}

// --- Handle exposed to callers --------------------------------------

/// Handle to an in-flight bob run. Caller stores it (e.g. in a
/// runId-keyed map) so a later `cancel()` can find it.
///
/// Dropping the handle does NOT cancel the run — the reader
/// threads + wait thread continue independently. Use `cancel()`
/// explicitly when the user closes the connection.
#[derive(Clone)]
pub struct BobRunHandle {
    inner: Arc<HandleInner>,
}

struct HandleInner {
    child: Mutex<Option<Child>>,
    cancelled: AtomicBool,
}

impl BobRunHandle {
    /// SIGTERM the bob process, then SIGKILL after 1.5s if it's
    /// still alive. Matches the timeout the old Node/Tauri paths
    /// used — bob is supposed to flush a final result on SIGTERM
    /// but we don't trust it to do so forever.
    pub fn cancel(&self) -> Result<(), String> {
        self.inner.cancelled.store(true, Ordering::SeqCst);
        let mut guard = self
            .inner
            .child
            .lock()
            .map_err(|e| format!("cancel lock: {e}"))?;
        let Some(child) = guard.as_mut() else {
            // Already exited.
            return Ok(());
        };
        // Best-effort SIGTERM. On Unix, kill() sends SIGKILL by
        // default; we use libc::kill for SIGTERM, falling back to
        // child.kill() if the libc call fails. Keep it portable —
        // on Windows there's only TerminateProcess via .kill().
        #[cfg(unix)]
        {
            let pid = child.id() as i32;
            // SAFETY: pid is the child's PID owned by this Child;
            // sending SIGTERM is well-defined.
            unsafe { libc::kill(pid, libc::SIGTERM) };
            // Spawn the SIGKILL fallback inline to avoid holding
            // the mutex while sleeping.
            let inner = Arc::clone(&self.inner);
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(1500));
                if let Ok(mut guard) = inner.child.lock() {
                    if let Some(child) = guard.as_mut() {
                        let _ = child.kill();
                    }
                }
            });
        }
        #[cfg(not(unix))]
        {
            let _ = child.kill();
        }
        Ok(())
    }

    /// Whether `cancel()` was called. Tagged on the final
    /// `Exited` event.
    pub fn was_cancelled(&self) -> bool {
        self.inner.cancelled.load(Ordering::SeqCst)
    }
}

// --- The actual run function ----------------------------------------

/// Spawn bob and stream output through `callback` until the
/// child exits. Returns a `BobRunHandle` immediately — the reader
/// + wait threads continue in the background.
///
/// `callback` is invoked from three threads (stdout reader,
/// stderr reader, exit watcher). It must be `Clone` + `Send` —
/// the Clone bound lets us hand a copy to each thread.
///
/// `run_id` is opaque to bob-core; the caller chooses the
/// identifier (UUID, hash, anything) and uses it to correlate
/// events with the handle.
pub fn spawn_bob<F>(
    opts: RunBobOptions,
    run_id: String,
    callback: F,
) -> Result<BobRunHandle, String>
where
    F: FnMut(BobRunEvent) + Send + Sync + Clone + 'static,
{
    let args = build_args(&opts);
    let api_key = resolve_api_key().map(|(value, _)| value).unwrap_or_default();
    let program: PathBuf = opts.bob_executable.clone().unwrap_or_else(|| PathBuf::from("bob"));
    let cwd = opts.cwd.unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    spawn_bob_raw(program, args, api_key, cwd, run_id, callback)
}

/// Lower-level spawn for callers that have already built the
/// argv, resolved the bob executable path, and loaded the API
/// key themselves. The Tauri runner uses this because it carries
/// its own locator + workspace-aware argv builder.
///
/// `bob-api` uses the higher-level `spawn_bob` which builds the
/// argv from `RunBobOptions`.
/// Thin bob-specific wrapper over [`spawn_streaming`]: sets bob's
/// `BOBSHELL_API_KEY` env var, otherwise identical. Kept so existing
/// bob callers (and `spawn_bob`) don't change.
pub fn spawn_bob_raw<F>(
    program: PathBuf,
    args: Vec<String>,
    api_key: String,
    cwd: PathBuf,
    run_id: String,
    callback: F,
) -> Result<BobRunHandle, String>
where
    F: FnMut(BobRunEvent) + Send + Sync + Clone + 'static,
{
    spawn_streaming(
        program,
        args,
        vec![("BOBSHELL_API_KEY".to_owned(), api_key)],
        cwd,
        run_id,
        callback,
    )
}

/// Spawn an arbitrary streaming child process — the generic engine
/// behind every process-backed harness (bob, Claude Code, Codex).
///
/// Pipes stdout/stderr line-by-line through `callback` using the raw
/// process-event vocabulary (`BobRunEvent`: Started / Stdout /
/// Stderr / Error / Exited — the name is historical; the shape is
/// harness-neutral). `env` supplies per-harness secrets (each
/// harness's API-key var). PATH is augmented so Node-based CLIs find
/// `node`. Returns a [`BobRunHandle`] for cancellation.
pub fn spawn_streaming<F>(
    program: PathBuf,
    args: Vec<String>,
    env: Vec<(String, String)>,
    cwd: PathBuf,
    run_id: String,
    callback: F,
) -> Result<BobRunHandle, String>
where
    F: FnMut(BobRunEvent) + Send + Sync + Clone + 'static,
{
    // PATH augmentation: Node-based CLIs (bob, claude, codex) expect
    // `node` (and often `npm`, `git`) on PATH. A desktop app launched
    // from Finder/Launchpad inherits only the minimal launchd PATH
    // (`/usr/bin:/bin:/usr/sbin:/sbin`), so an nvm-installed node is
    // invisible and the child exits 127 ("command not found").
    //
    // Fix: prepend the program's parent dir (where node also lives in
    // an nvm install) to the child's PATH. Added, not replaced, so a
    // PATH the user explicitly set still wins on later lookups.
    let augmented_path = augment_path_for_node(&program);

    let mut command = Command::new(&program);
    command
        .args(&args)
        .current_dir(&cwd)
        .env("PATH", augmented_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in &env {
        command.env(key, value);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {e}", program.display()))?;

    let stdout = child.stdout.take().ok_or("bob stdout was not captured")?;
    let stderr = child.stderr.take().ok_or("bob stderr was not captured")?;

    let inner = Arc::new(HandleInner {
        child: Mutex::new(Some(child)),
        cancelled: AtomicBool::new(false),
    });
    let handle = BobRunHandle { inner: Arc::clone(&inner) };

    // 5. Emit Started immediately so the caller doesn't wait on
    //    the first bob line for a UI signal.
    let mut started_cb = callback.clone();
    started_cb(BobRunEvent::Started { run_id: run_id.clone() });

    // 6. Reader threads. Each owns its own callback clone — the
    //    Clone bound is the whole point.
    let stdout_cb = callback.clone();
    let stdout_run_id = run_id.clone();
    let stdout_handle = thread::spawn(move || {
        pump_lines(stdout, stdout_run_id, true, stdout_cb);
    });

    let stderr_cb = callback.clone();
    let stderr_run_id = run_id.clone();
    let stderr_handle = thread::spawn(move || {
        pump_lines(stderr, stderr_run_id, false, stderr_cb);
    });

    // 7. Exit watcher — waits on the child, joins the reader
    //    threads, then emits the terminal Exited event with the
    //    cancellation flag.
    let exit_inner = Arc::clone(&inner);
    let mut exit_cb = callback;
    let exit_run_id = run_id;
    thread::spawn(move || {
        // Hold the lock only long enough to call wait(). Drop
        // before joining threads so cancel() can still acquire
        // the lock if needed.
        let wait_result = {
            let mut guard = exit_inner.child.lock().ok();
            guard.as_mut().and_then(|g| g.as_mut().map(|c| c.wait()))
        };
        let _ = stdout_handle.join();
        let _ = stderr_handle.join();
        let cancelled = exit_inner.cancelled.load(Ordering::SeqCst);

        match wait_result {
            Some(Ok(status)) => exit_cb(BobRunEvent::Exited {
                run_id: exit_run_id.clone(),
                exit_code: status.code(),
                cancelled,
            }),
            Some(Err(err)) => exit_cb(BobRunEvent::Error {
                run_id: exit_run_id.clone(),
                message: format!("wait failed: {err}"),
            }),
            None => {}
        }

        // Drop the child handle so subsequent cancel() calls
        // short-circuit cleanly.
        if let Ok(mut guard) = exit_inner.child.lock() {
            *guard = None;
        }
    });

    Ok(handle)
}

// --- Internals ------------------------------------------------------

fn pump_lines<R, F>(reader: R, run_id: String, is_stdout: bool, mut callback: F)
where
    R: Read,
    F: FnMut(BobRunEvent),
{
    let buffered = BufReader::new(reader);
    for line in buffered.lines() {
        match line {
            Ok(text) => {
                let event = if is_stdout {
                    BobRunEvent::Stdout { run_id: run_id.clone(), line: text }
                } else {
                    BobRunEvent::Stderr { run_id: run_id.clone(), line: text }
                };
                callback(event);
            }
            Err(err) => {
                callback(BobRunEvent::Error {
                    run_id: run_id.clone(),
                    message: format!("stream read failed: {err}"),
                });
                return;
            }
        }
    }
}

/// Compose a PATH for the spawned bob process that always
/// includes the directory containing the bob executable —
/// where `node`, `npm`, and friends usually live in an nvm
/// install.
///
/// When the parent process was launched from Finder/Launchpad,
/// `std::env::var("PATH")` is the minimal launchd default. nvm
/// shims aren't there, so a `node` lookup from inside bob's
/// shebang or subprocess fails with exit 127. Prepending the
/// bob dir gives bob's children somewhere to find node.
///
/// The user's existing PATH (whatever the parent inherited)
/// stays as a fallback after our prepended directory.
fn augment_path_for_node(program: &std::path::Path) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(parent) = program.parent() {
        let parent_str = parent.display().to_string();
        if !parent_str.is_empty() {
            parts.push(parent_str);
        }
    }
    parts.push(augmented_node_path());
    parts.join(":")
}

/// A PATH that resolves Node-based CLIs (bob, claude, codex) even from a
/// process launched by Finder/Launchpad, which inherits only the minimal
/// launchd PATH (`/usr/bin:/bin:/usr/sbin:/sbin`).
///
/// Used both by the run path (which prepends the resolved binary's own
/// directory on top of this) and — crucially — by the readiness probes
/// that locate `claude`/`codex` via a bare `Command::new(name)`. Without
/// this, the packaged `.app` reports installed CLIs as "not installed"
/// because their bin dir (nvm, ~/.local/bin, Homebrew) isn't on the
/// launchd PATH. The caller's existing PATH stays first as a fallback;
/// added directories never replace it.
pub fn augmented_node_path() -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Ok(existing) = std::env::var("PATH") {
        if !existing.is_empty() {
            parts.push(existing);
        }
    }
    // macOS defaults — covers Homebrew (Apple Silicon + Intel) and the
    // system bins a launchd process might otherwise lack entirely.
    parts.push("/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin".to_owned());
    if let Ok(home) = std::env::var("HOME") {
        if !home.is_empty() {
            let home_path = std::path::Path::new(&home);
            // Official-installer location for several agent CLIs.
            parts.push(home_path.join(".local/bin").display().to_string());
            // nvm: ~/.nvm/versions/node/<version>/bin — where npm-global
            // CLIs (bob, claude, codex) live under an nvm-managed node.
            if let Ok(entries) = std::fs::read_dir(home_path.join(".nvm/versions/node")) {
                for entry in entries.flatten() {
                    let bin = entry.path().join("bin");
                    if bin.is_dir() {
                        parts.push(bin.display().to_string());
                    }
                }
            }
        }
    }
    parts.join(":")
}

/// Build the bob CLI argv. Mirrors the structure used by both
/// the Vite `bobRunPlugin` and the Tauri `build_bob_command`.
fn build_args(opts: &RunBobOptions) -> Vec<String> {
    vec![
        opts.prompt.clone(),
        "--chat-mode".to_owned(),
        opts.chat_mode.as_cli_value().to_owned(),
        "--output-format".to_owned(),
        "stream-json".to_owned(),
        "--approval-mode".to_owned(),
        opts.approval_mode.as_cli_value().to_owned(),
        "--accept-license".to_owned(),
        "--max-coins".to_owned(),
        opts.max_coins.to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn augmented_node_path_includes_macos_defaults() {
        // These must always be present so a launchd-spawned `.app` can
        // resolve Homebrew-installed CLIs and the system bins — this is the
        // fix for claude/codex being mis-reported as "not installed".
        let path = augmented_node_path();
        assert!(path.contains("/opt/homebrew/bin"), "missing Apple-Silicon Homebrew bin");
        assert!(path.contains("/usr/local/bin"), "missing Intel Homebrew / system bin");
        assert!(path.contains("/usr/bin"), "missing system bin");
    }

    #[test]
    fn augment_path_for_node_prepends_the_program_dir() {
        let combined = augment_path_for_node(std::path::Path::new("/Users/x/.nvm/versions/node/v22/bin/bob"));
        assert!(combined.starts_with("/Users/x/.nvm/versions/node/v22/bin:"));
        assert!(combined.contains("/opt/homebrew/bin"));
    }
}
