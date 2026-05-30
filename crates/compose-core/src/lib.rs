//! Compose's harness adapters + registry.
//!
//! The neutral harness *contract* — the [`Harness`] trait, the
//! normalized [`RunEvent`] vocabulary, the request/metadata types, the
//! subprocess engine — now lives in the publishable [`harness_core`]
//! crate. This crate is the Compose-specific layer on top of it:
//!
//!   * the **bob adapter** ([`BobHarness`]), which wraps the standalone
//!     [`bob_core`] SDK + bob's stream-json parser ([`events`]);
//!   * the **Claude Code** and **Codex** adapters ([`claude`] / [`codex`]); and
//!   * the **registry** ([`registry`] / [`harness_by_id`] /
//!     [`harness_catalog`]) the two hosts (`src-tauri`, `bob-api`) resolve
//!     the active harness through.
//!
//! (Commit 3 splits these into per-adapter crates — `harness-bob` /
//! `harness-claude` / `harness-codex` — plus a `compose-harness` manager
//! for the registry; this crate is then dissolved.)

use std::sync::{Arc, Mutex};

use bob_core::{
    get_readiness, install_bob, spawn_bob, BobApprovalMode, BobChatMode, RunBobOptions,
    KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE,
};

pub mod claude;
pub mod codex;
pub mod events;

use claude::ClaudeHarness;
use codex::CodexHarness;
use events::BobStreamParser;

// The neutral harness contract lives in `harness-core`. Re-export the
// pieces this crate uses (and, transitionally, the desktop host still
// reaches via `compose_core::*`) so existing paths keep resolving until
// commit 3 repoints the host at `harness_core` / `compose_harness`
// directly. `pub use` also brings them into scope for `BobHarness` below.
pub use harness_core::{
    normalize_process_event, run_login_command, ByteRange, CredentialSpec, Harness,
    HarnessCapabilities, HarnessInfo, HarnessModel, HarnessReadiness, InstallCallback,
    ReasoningEffort, RunCallback, RunControl, RunEvent, RunHandle, RunMode, RunRequest, RunTuning,
    SuggestedEdit,
};

/// The identifier of the harness used when the caller does not pick
/// one. Keeps existing single-harness behaviour the default.
pub const DEFAULT_HARNESS_ID: &str = "bob";

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
        // bob emits its own process events (lifecycle + raw stream-json
        // stdout lines). Normalize each into zero or more harness-neutral
        // `RunEvent`s here, so the consumer only ever sees the normalized
        // shape — the keystone of the abstraction. bob streams its
        // reasoning inline as `<thinking>…</thinking>` and its answer via
        // the `attempt_completion` tool, across many lines — so parsing is
        // stateful. Hold one `BobStreamParser` for the whole run; the
        // stdout reader thread drives it sequentially, the `Mutex` just
        // satisfies the `Fn + Send + Sync` callback bound.
        let parser = Arc::new(Mutex::new(BobStreamParser::default()));
        let handle = spawn_bob(opts, request.run_id, move |event| {
            let mut parser = parser.lock().expect("bob stream parser mutex");
            for normalized in normalize_process_event(event, |line| parser.parse_line(line)) {
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
/// harnesses (bob, Claude Code, Codex) live here.
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
