//! Compose's harness registry — the one place the set of available
//! harnesses is declared, shared by both hosts (`src-tauri` desktop +
//! `bob-api` dev).
//!
//! The neutral contract lives in [`agent_harness`]; each adapter is its
//! own crate ([`harness_bob`] / [`harness_claude`] / [`harness_codex`]).
//! This crate is the *manager*: it depends on the adapters it wants to
//! offer and exposes [`registry`] / [`harness_by_id`] / [`harness_catalog`]
//! over them. Adding a harness to the product is a one-line change to
//! [`registry`] (plus the new adapter crate as a dependency).
//!
//! (Why a separate crate rather than putting the registry in a host: the
//! two hosts would otherwise each need their own copy. One manager crate
//! gives them a single, consistently-ordered registry.)

use harness_bob::BobHarness;
use harness_claude::ClaudeHarness;
use harness_codex::CodexHarness;
use agent_harness::{Harness, HarnessInfo};

/// The identifier of the harness used when the caller does not pick
/// one. Keeps existing single-harness behaviour the default. Sourced
/// from the bob adapter so the default id has one owner.
pub const DEFAULT_HARNESS_ID: &str = harness_bob::BOB_HARNESS_ID;

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
        assert_eq!(
            bob.credential_required,
            harness_by_id("bob").unwrap().credential().required
        );

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
}
