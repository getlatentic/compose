//! Compose — the neutral agent-harness layer.
//!
//! A *harness* is whatever actually answers the user's prompt — the
//! `bob` CLI today, a direct LLM API tomorrow, some other agent
//! runner after that. Compose (the product) does not care which; it
//! only needs to: probe whether a harness is ready, run a one-time
//! install if required, stream a run, and know which credential to
//! ask for.
//!
//! This crate is the seam that makes "use your preferred AI
//! collaborator" a configuration choice rather than a fork. `bob` is
//! the first adapter ([`BobHarness`]), not the foundation — it wraps
//! the standalone [`bob_core`] SDK.
//!
//! ## Why a separate crate from `bob-core`
//!
//! `bob-core` is a clean, publishable *unofficial bob SDK*: detection,
//! install, run, keychain — nothing about Compose or the harness
//! abstraction. Keeping the `Harness` trait here, in a crate that
//! *depends on* `bob-core`, means the SDK never grows a dependency on
//! the app's abstraction, and future adapters (a hosted LLM API) can
//! implement `Harness` without pulling in bob at all.
//!
//! ## Design rules
//!
//! - **Object-safe trait.** Consumers hold `Box<dyn Harness>` from
//!   the [`registry`]; no generics leak across the seam.
//! - **Arc callbacks, not generic closures.** Streaming methods take
//!   `Arc<dyn Fn(..) + Send + Sync>` so they stay object-safe and can
//!   be cloned onto the reader threads `bob_core::spawn_bob` uses.
//! - **Normalize at the adapter, not the UI** (lands in H3). The
//!   event enums here are harness-neutral by intent; `BobHarness`
//!   will translate bob's NDJSON into them so the front-end consumes
//!   one shape regardless of which harness produced it.

use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};

use serde::{Deserialize, Serialize};

use bob_core::{
    get_readiness, install_bob, spawn_bob, spawn_streaming, BobApprovalMode, BobChatMode,
    BobRunEvent, BobRunHandle, InstallEvent, RunBobOptions, KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE,
};

pub mod claude;
pub mod codex;
pub mod events;

use claude::ClaudeHarness;
use codex::CodexHarness;
use events::normalize_bob_event;

/// The identifier of the harness used when the caller does not pick
/// one. Keeps existing single-harness behaviour the default.
pub const DEFAULT_HARNESS_ID: &str = "bob";

// --- Streaming callbacks --------------------------------------------

/// The normalized run event every harness emits — defined in
/// [`events`]. Each adapter parses its own wire format into this one
/// shape, so the front-end learns exactly one event vocabulary. See
/// that module for the variants and bob's parser.
pub use events::{ByteRange, RunEvent, SuggestedEdit};

/// Callback a harness invokes for each run event. `Arc<dyn Fn>` is
/// `Clone + Send + Sync`, so it can be handed to the multiple reader
/// threads a process-backed harness uses without the trait method
/// needing to be generic.
pub type RunCallback = Arc<dyn Fn(RunEvent) + Send + Sync>;

/// Callback a harness invokes for each install event.
pub type InstallCallback = Arc<dyn Fn(InstallEvent) + Send + Sync>;

// --- Run control (cancellation) -------------------------------------

/// Object-safe handle to an in-flight run. A process-backed harness
/// (bob) cancels by signalling its child; a request-backed harness
/// (a hosted LLM API) cancels by aborting its HTTP stream. The
/// consumer only needs these two operations, so the concrete
/// mechanism stays behind the trait.
pub trait RunControl: Send + Sync {
    /// Stop the run. Best-effort; idempotent.
    fn cancel(&self) -> Result<(), String>;
    /// Whether [`cancel`](RunControl::cancel) was called.
    fn was_cancelled(&self) -> bool;
}

/// Boxed [`RunControl`] returned by [`Harness::run`].
pub type RunHandle = Box<dyn RunControl>;

impl RunControl for BobRunHandle {
    fn cancel(&self) -> Result<(), String> {
        BobRunHandle::cancel(self)
    }
    fn was_cancelled(&self) -> bool {
        BobRunHandle::was_cancelled(self)
    }
}

// --- Neutral request / metadata shapes ------------------------------

/// What the user wants the harness to do with the prompt. Mirrors
/// the Ask / Edit split the comment bubble already exposes; adapters
/// map it onto their own mode vocabulary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RunMode {
    /// Answer / discuss. No file edits expected.
    Ask,
    /// Propose edits to the workspace.
    Edit,
}

/// How hard the model should think, in harness-neutral terms. Codex
/// maps this onto `model_reasoning_effort`; Claude Code has no
/// equivalent `-p` flag today and ignores it. Kept neutral so a future
/// harness that exposes effort can honor the same field.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReasoningEffort {
    Minimal,
    Low,
    Medium,
    High,
}

impl ReasoningEffort {
    /// The CLI/config token for this level (e.g. codex's
    /// `model_reasoning_effort="high"`).
    pub fn as_cli_value(self) -> &'static str {
        match self {
            ReasoningEffort::Minimal => "minimal",
            ReasoningEffort::Low => "low",
            ReasoningEffort::Medium => "medium",
            ReasoningEffort::High => "high",
        }
    }
}

/// User-chosen, harness-neutral run-shaping knobs. Every field is
/// optional; each adapter maps the ones its CLI supports and ignores
/// the rest (Claude has no reasoning-effort flag; Codex has no
/// max-turns flag). Grouped into one struct so the neutral
/// [`RunRequest`] stays open for extension — a new knob is a field
/// here, not a new positional parameter threaded through every caller.
#[derive(Debug, Clone, Default)]
pub struct RunTuning {
    /// Model id or alias passed verbatim to the CLI (`--model` /
    /// `-m`). `None` → let the CLI use its configured default.
    pub model: Option<String>,
    /// Reasoning effort (Codex: `-c model_reasoning_effort`).
    pub effort: Option<ReasoningEffort>,
    /// Cap on agentic turns (Claude: `--max-turns`).
    pub max_turns: Option<u32>,
}

/// A harness-neutral run request. Adapter-specific knobs (bob's
/// approval mode, coin budget, executable override) are filled in by
/// the adapter from its own defaults; the user-facing tuning the
/// picker exposes (model, effort, turn cap) rides on `tuning`.
#[derive(Debug, Clone)]
pub struct RunRequest {
    /// Caller-chosen id used to correlate events with the handle.
    pub run_id: String,
    pub prompt: String,
    /// Working directory for the run — the workspace path, so the
    /// harness's tool calls land inside the user's vault.
    pub cwd: Option<PathBuf>,
    pub mode: RunMode,
    /// Optional, harness-neutral run-shaping knobs (model, effort,
    /// turn cap). Adapters honor the subset their CLI supports.
    pub tuning: RunTuning,
}

/// Where a harness's secret lives in the OS keychain, and how to
/// label it in the UI. Lets the front-end ask for the right
/// credential per harness without hard-coding bob's slot.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSpec {
    /// Human label, e.g. "Bob API key" / "Anthropic API key".
    pub label: String,
    pub keychain_service: String,
    pub keychain_account: String,
    /// Whether the harness can run at all without this credential.
    pub required: bool,
}

/// Harness-neutral readiness snapshot for the UI. `details` carries
/// adapter-specific probes (bob's Node/npm) as free-form JSON so the
/// trait stays generic.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessReadiness {
    pub harness_id: String,
    /// Installed *and* authenticated *and* able to run.
    pub ready: bool,
    pub installed: bool,
    pub version: Option<String>,
    pub auth_configured: bool,
    pub error: Option<String>,
    /// Adapter-specific extra fields (serialized harness snapshot).
    pub details: serde_json::Value,
}

/// A model the harness can be pointed at, for the picker's model
/// selector. `value` is passed verbatim to the CLI (`--model` / `-m`)
/// via [`RunTuning::model`]; `label` is the human-facing name.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessModel {
    pub value: String,
    pub label: String,
}

/// What a harness supports, so every consumer (the picker, the options
/// panel, the credential preflight, the chat availability gate) adapts
/// to it *declaratively* instead of branching on the harness id. A new
/// adapter that, say, needs a stored key just sets `credential_required:
/// true` here — no `id == "bob"` checks to hunt down.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessCapabilities {
    /// Compose stores this harness's credential (bob). When `false`,
    /// the CLI owns its own login (claude/codex) and Compose runs no
    /// credential/install preflight — a missing login surfaces as the
    /// harness's own run error rather than a Compose prompt.
    pub credential_required: bool,
    /// Emits previewable suggested edits the user approves before they
    /// apply (bob). When `false`, edits land on disk directly and the
    /// file watcher reflects them (claude/codex).
    pub previews_edits: bool,
    /// Curated model choices for the picker's selector. Empty → no
    /// curated list (rely on `allows_custom_model`).
    pub models: Vec<HarnessModel>,
    /// Whether a free-text model id is accepted beyond `models` (codex,
    /// whose model names change frequently). Drives a text field vs a
    /// fixed dropdown in the picker.
    pub allows_custom_model: bool,
    /// Honors [`RunTuning::effort`] (codex reasoning effort).
    pub supports_effort: bool,
    /// Honors [`RunTuning::max_turns`] (claude turn cap).
    pub supports_max_turns: bool,
    /// Supports an interactive [`Harness::login`] flow (the CLI's own
    /// OAuth, e.g. `claude auth login` / `codex login`). Drives the
    /// picker's "Sign in" affordance when installed-but-not-signed-in.
    /// `false` for harnesses Compose authenticates itself (bob).
    pub supports_login: bool,
}

/// Static metadata for the harness picker.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarnessInfo {
    pub id: String,
    pub display_name: String,
    pub description: String,
    /// True if the harness needs a one-time [`Harness::install`].
    pub requires_install: bool,
    /// Declarative capabilities — what the harness supports, so the UI
    /// and run-gating never special-case its id.
    pub capabilities: HarnessCapabilities,
}

// --- The trait ------------------------------------------------------

/// A pluggable agent backend. Implementors are cheap to construct
/// (they hold config, not connections) so the registry can hand out
/// fresh boxes on demand.
pub trait Harness: Send + Sync {
    /// Static metadata for the UI.
    fn info(&self) -> HarnessInfo;

    /// Probe availability / version / auth. May shell out; callers
    /// should treat it as blocking and run it off the UI thread.
    fn readiness(&self) -> HarnessReadiness;

    /// Stream a one-time install. Harnesses that need no install
    /// (e.g. a hosted-API adapter) return `Ok(())` immediately.
    fn install(&self, on_event: InstallCallback) -> Result<(), String>;

    /// Start a run, streaming events through `on_event`. Returns a
    /// handle immediately; work continues on background threads.
    fn run(&self, request: RunRequest, on_event: RunCallback) -> Result<RunHandle, String>;

    /// The credential this harness needs.
    fn credential(&self) -> CredentialSpec;

    /// Trigger the harness's own interactive sign-in (its CLI's OAuth),
    /// streaming progress as [`InstallEvent`]s — the same subprocess
    /// stream shape as [`install`](Harness::install). The flow opens the
    /// user's browser; this blocks until the login process exits, then
    /// `Done { ok }` reports success. Default: unsupported — harnesses
    /// that Compose authenticates itself (bob, via its API key) keep it.
    fn login(&self, _on_event: InstallCallback) -> Result<(), String> {
        Err("This harness does not support interactive sign-in.".to_owned())
    }
}

/// Run a harness's interactive sign-in command, streaming its output as
/// [`InstallEvent`]s and blocking until it exits. Reuses
/// [`bob_core::spawn_streaming`] (PATH augmentation + reader threads, so
/// a packaged `.app` finds the CLI), mapping its process events onto the
/// install-stream shape (Step / Stdout / Stderr / Done). The login CLI
/// opens the user's browser for OAuth; we surface its output (incl. any
/// device-code URL) so the UI can show progress. Blocks on a condvar
/// until the process exits — the caller is a Tauri `(async)` command on
/// a worker thread, so the UI never blocks.
pub(crate) fn run_login_command(
    program: &str,
    args: &[&str],
    on_event: InstallCallback,
) -> Result<(), String> {
    (*on_event)(InstallEvent::Step {
        text: "Opening your browser to sign in…".to_owned(),
    });
    let done = Arc::new((Mutex::new(false), Condvar::new()));
    let done_cb = Arc::clone(&done);
    let events_cb = Arc::clone(&on_event);
    // Bound, not `_`, so the handle outlives the wait (dropping it could
    // signal the child); by the time we return, the process has exited.
    let _handle = spawn_streaming(
        PathBuf::from(program),
        args.iter().map(|s| (*s).to_owned()).collect(),
        Vec::new(),
        std::env::current_dir().unwrap_or_default(),
        format!("login-{program}"),
        move |event| match event {
            BobRunEvent::Started { .. } => {}
            BobRunEvent::Stdout { line, .. } => {
                (*events_cb)(InstallEvent::Stdout { text: line });
            }
            BobRunEvent::Stderr { line, .. } => {
                (*events_cb)(InstallEvent::Stderr { text: line });
            }
            BobRunEvent::Error { message, .. } => {
                (*events_cb)(InstallEvent::Stderr { text: message });
            }
            BobRunEvent::Exited { exit_code, .. } => {
                (*events_cb)(InstallEvent::Done {
                    exit_code,
                    ok: exit_code == Some(0),
                });
                let (lock, cvar) = &*done_cb;
                *lock.lock().unwrap() = true;
                cvar.notify_all();
            }
        },
    )?;
    let (lock, cvar) = &*done;
    let mut finished = lock.lock().unwrap();
    while !*finished {
        finished = cvar.wait(finished).unwrap();
    }
    Ok(())
}

// --- bob adapter ----------------------------------------------------

/// `bob` CLI as a [`Harness`]. Delegates to the [`bob_core`] SDK;
/// this is just the neutral face over it.
#[derive(Debug, Default, Clone)]
pub struct BobHarness;

impl BobHarness {
    pub fn new() -> Self {
        Self
    }
}

impl Harness for BobHarness {
    fn info(&self) -> HarnessInfo {
        HarnessInfo {
            id: DEFAULT_HARNESS_ID.to_owned(),
            display_name: "Bob".to_owned(),
            description: "IBM's bob agent CLI. Runs locally via Node.js.".to_owned(),
            requires_install: true,
            capabilities: HarnessCapabilities {
                // Compose stores bob's API key, and bob proposes
                // previewable edits the user approves. It exposes no
                // model / effort / turn-cap knobs in the picker today.
                credential_required: true,
                previews_edits: true,
                models: Vec::new(),
                allows_custom_model: false,
                supports_effort: false,
                supports_max_turns: false,
                supports_login: false,
            },
        }
    }

    fn readiness(&self) -> HarnessReadiness {
        let snapshot = get_readiness();
        // Preserve the rich bob probe for the UI while presenting a
        // neutral top-level shape. Serialization can't realistically
        // fail for this owned struct; fall back to null if it does.
        let details = serde_json::to_value(&snapshot).unwrap_or(serde_json::Value::Null);
        HarnessReadiness {
            harness_id: DEFAULT_HARNESS_ID.to_owned(),
            ready: snapshot.ready,
            installed: snapshot.bob.installed,
            version: snapshot.bob.version.clone(),
            auth_configured: snapshot.auth.configured,
            error: snapshot.bob.error.clone(),
            details,
        }
    }

    fn install(&self, on_event: InstallCallback) -> Result<(), String> {
        // The closure captures only the `Arc` (Clone + Send + Sync +
        // 'static), so it satisfies `install_bob`'s `F: FnMut + Send
        // + Sync + Clone + 'static` bound.
        install_bob(move |event| (*on_event)(event))
    }

    fn run(&self, request: RunRequest, on_event: RunCallback) -> Result<RunHandle, String> {
        let opts = RunBobOptions {
            prompt: request.prompt,
            chat_mode: match request.mode {
                RunMode::Ask => BobChatMode::Ask,
                // "Edit" maps onto bob's code mode — the one that
                // proposes file changes.
                RunMode::Edit => BobChatMode::Code,
            },
            // H2 threads the live approval/coin knobs through; bob's
            // serde defaults are correct for the additive seam.
            approval_mode: BobApprovalMode::Default,
            max_coins: 30,
            cwd: request.cwd,
            bob_executable: None,
        };
        // bob emits its own `BobRunEvent`s (lifecycle + raw
        // stream-json stdout lines). Normalize each into zero or more
        // harness-neutral `RunEvent`s here, so the consumer only ever
        // sees the normalized shape — the keystone of the abstraction.
        let handle = spawn_bob(opts, request.run_id, move |event| {
            for normalized in normalize_bob_event(event) {
                (*on_event)(normalized);
            }
        })?;
        Ok(Box::new(handle))
    }

    fn credential(&self) -> CredentialSpec {
        CredentialSpec {
            label: "Bob API key".to_owned(),
            keychain_service: KEYCHAIN_SERVICE.to_owned(),
            keychain_account: KEYCHAIN_ACCOUNT.to_owned(),
            required: true,
        }
    }
}

// --- Registry -------------------------------------------------------

/// All harnesses the build knows about. Order is the UI display
/// order; the first entry is the default. Process-backed CLI
/// harnesses (bob, Claude Code) live here; H4c adds the no-install
/// API adapter, which H5 will make the OSS default.
pub fn registry() -> Vec<Box<dyn Harness>> {
    vec![
        Box::new(BobHarness::new()),
        Box::new(ClaudeHarness::new()),
        Box::new(CodexHarness::new()),
    ]
}

/// Resolve a harness by its [`HarnessInfo::id`]. Derived from
/// [`registry()`] so the set of harnesses is declared in exactly one
/// place — adding an adapter to `registry()` makes it resolvable here
/// automatically. Returns `None` for an unknown id so callers can fall
/// back to [`DEFAULT_HARNESS_ID`].
pub fn harness_by_id(id: &str) -> Option<Box<dyn Harness>> {
    registry().into_iter().find(|harness| harness.info().id == id)
}

/// Metadata for every registered harness — the payload the UI picker
/// renders.
pub fn harness_catalog() -> Vec<HarnessInfo> {
    registry().into_iter().map(|h| h.info()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_contains_bob_as_default() {
        let catalog = harness_catalog();
        assert!(!catalog.is_empty(), "registry must not be empty");
        assert_eq!(catalog[0].id, DEFAULT_HARNESS_ID);
        assert_eq!(catalog[0].id, "bob");
    }

    #[test]
    fn harness_by_id_resolves_all_registered_and_rejects_unknown() {
        assert!(harness_by_id("bob").is_some());
        assert!(harness_by_id("claude").is_some());
        assert!(harness_by_id("codex").is_some());
        assert!(harness_by_id("nope").is_none());
    }

    #[test]
    fn catalog_lists_every_registered_harness() {
        let ids: Vec<String> = harness_catalog().into_iter().map(|h| h.id).collect();
        assert_eq!(ids, vec!["bob", "claude", "codex"]);
        // Every catalog id must round-trip through harness_by_id.
        for id in &ids {
            assert!(harness_by_id(id).is_some(), "{id} not resolvable");
        }
    }

    #[test]
    fn bob_credential_points_at_the_shared_keychain_slot() {
        let cred = BobHarness::new().credential();
        assert_eq!(cred.keychain_service, KEYCHAIN_SERVICE);
        assert_eq!(cred.keychain_account, KEYCHAIN_ACCOUNT);
        assert!(cred.required);
    }

    #[test]
    fn bob_info_requires_install() {
        assert!(BobHarness::new().info().requires_install);
    }

    #[test]
    fn capabilities_match_each_adapter_and_back_credential_required() {
        let caps = |id: &str| harness_by_id(id).unwrap().info().capabilities;

        // bob: Compose stores its key + it previews edits; no model/knob UI.
        let bob = caps("bob");
        assert!(bob.credential_required);
        assert!(bob.previews_edits);
        assert!(bob.models.is_empty());
        assert!(!bob.supports_effort && !bob.supports_max_turns);
        // `credential_required` must agree with the credential spec — the
        // frontend gates its preflight on this capability, so they can't drift.
        assert_eq!(bob.credential_required, BobHarness::new().credential().required);

        // claude: own login, edits on disk, curated models + turn cap.
        let claude = caps("claude");
        assert!(!claude.credential_required && !claude.previews_edits);
        assert!(!claude.models.is_empty() && !claude.allows_custom_model);
        assert!(claude.supports_max_turns && !claude.supports_effort);

        // codex: own login, edits on disk, free-text model + reasoning effort.
        let codex = caps("codex");
        assert!(!codex.credential_required && !codex.previews_edits);
        assert!(codex.allows_custom_model && codex.supports_effort);
        assert!(!codex.supports_max_turns);

        // supports_login: claude/codex own an interactive OAuth sign-in;
        // bob authenticates via its stored API key, so it does not.
        assert!(claude.supports_login && codex.supports_login);
        assert!(!bob.supports_login);
    }

    #[test]
    fn bob_default_login_is_unsupported() {
        let cb: InstallCallback = std::sync::Arc::new(|_| {});
        assert!(BobHarness::new().login(cb).is_err());
    }
}
