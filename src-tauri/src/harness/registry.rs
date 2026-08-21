//! Compose's harness set: the agent-harness built-ins plus the providers that
//! need host-supplied wiring (OpenRouter's endpoint + key, Ollama's local
//! server, OpenCode's ACP command).

use harness::{
    AcpHarness, ApiKey, Claude, Codex, Harness, Listing, OpenHarness, OpenHarnessConfig,
    Readiness, Registry,
};

fn openrouter() -> OpenHarness {
    OpenHarness::custom(OpenHarnessConfig {
        id: "openrouter".to_owned(),
        display_name: "OpenRouter".to_owned(),
        base_url: "https://openrouter.ai/api".to_owned(),
        // The key is handed over as a value, not exported. An environment
        // variable is inherited by every child the agent spawns — the `bash`
        // tool among them — which would let the model read the very secret the
        // encrypted store exists to protect. `ApiKey` also carries "needed but
        // absent" in the same field, so Settings still offers the slot when the
        // vault has nothing yet, and the two cannot contradict each other.
        api_key: crate::harness::credentials::secret_for("openrouter")
            .map_or(ApiKey::Required, ApiKey::Value),
        ..Default::default()
    })
    .with_models_dev("openrouter")
}

/// The non-built-in providers, also the set whose keys are exported to the env at
/// boot (built-ins are exported per-run — a boot keychain read on a re-signed
/// build can block on a permission prompt).
pub(crate) fn extra_harnesses() -> Vec<Box<dyn Harness>> {
    vec![
        Box::new(OpenHarness::ollama()),
        Box::new(openrouter()),
        Box::new(AcpHarness::opencode()),
    ]
}

/// Compose's full harness set as one registry. Registration order **is** the
/// display + default-preference order: the first available harness here is the
/// recommended default, so reordering this list reorders the picker and the
/// auto-pick. The single source for resolution, the catalog, and discovery.
pub fn compose_registry() -> Registry {
    // Ollama (local, free, private) leads — the local-first pick for this app;
    // the first *available* harness here is the recommended auto-pick default.
    let mut registry = Registry::new()
        .register(OpenHarness::ollama())
        .register(Claude::new())
        .register(Codex::new())
        .register(openrouter())
        .register(AcpHarness::opencode());
    // User-registered agents rank after the built-in providers.
    for harness in crate::harness::custom::custom_agent_store().build_harnesses() {
        registry = registry.register_boxed(harness);
    }
    registry
}

pub fn compose_harness_by_id(id: &str) -> Option<Box<dyn Harness>> {
    compose_registry().into_by_id(id)
}

/// The registry's own listing shape — identity plus capability per agent.
///
/// agent-harness keeps the two apart on the trait (identity is asked once,
/// capability constantly) and rejoins them in `Listing` precisely because a
/// picker needs both for every row. Compose has nothing to add, so it passes
/// that through rather than defining a near-copy; the front end flattens it in
/// its own IPC client.
pub fn compose_harness_catalog() -> Vec<Listing> {
    compose_registry().catalog()
}

/// Readiness of every registered harness — "what's actually on this machine."
///
/// Probes every harness CONCURRENTLY: each `readiness()` may shell out to a CLI
/// (~1s), so the registry's serial `discover()` makes the picker's "checking…"
/// state drag for several seconds across the full set. Each thread rebuilds its
/// own harness (cheap struct construction) so no `Box<dyn Harness>` crosses a
/// thread boundary — only the id goes in and the readiness comes out.
pub fn compose_discover() -> Vec<Readiness> {
    let handles: Vec<_> = compose_harness_catalog()
        .into_iter()
        .map(|entry| {
            let id = entry.manifest.id;
            std::thread::spawn(move || compose_harness_by_id(&id).map(|harness| harness.readiness()))
        })
        .collect();
    handles
        .into_iter()
        .filter_map(|handle| handle.join().ok().flatten())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The `harness_list` payload, as the front end receives it.
    ///
    /// This is the contract that broke silently: agent-harness split identity
    /// from capability and renamed the capability fields, and nothing here
    /// noticed until the crate stopped compiling. A shape test fails on the
    /// rename that matters — one the compiler would have accepted, because
    /// serde is happy to emit any field name at all.
    #[test]
    fn the_catalog_crosses_to_the_front_end_in_the_shape_it_reads() {
        let catalog = compose_harness_catalog();
        assert!(!catalog.is_empty(), "Compose registers agents");

        let wire = serde_json::to_value(&catalog).expect("the catalog serializes");
        let first = &wire[0];

        // Identity and capability arrive as two objects; `harnessClient.ts`
        // flattens them. Renaming either key breaks the picker with no
        // compile error anywhere.
        let manifest = first.get("manifest").expect("manifest object");
        let capabilities = first.get("capabilities").expect("capabilities object");

        for key in ["id", "displayName", "description", "installHint"] {
            assert!(manifest.get(key).is_some(), "manifest.{key} missing from {manifest}");
        }
        for key in [
            "credentialRequired",
            "previewsEdits",
            "models",
            "customModel",
            "effort",
            "maxTurns",
            "login",
            "customInstructions",
        ] {
            assert!(
                capabilities.get(key).is_some(),
                "capabilities.{key} missing from {capabilities}",
            );
        }
    }

    #[test]
    fn every_registered_agent_can_be_built_by_its_own_id() {
        // `compose_discover` spawns a thread per id and rebuilds the harness
        // there, so an id the registry lists but cannot resolve silently drops
        // that agent from the picker rather than failing.
        for entry in compose_harness_catalog() {
            let id = entry.manifest.id;
            assert!(compose_harness_by_id(&id).is_some(), "{id} listed but not resolvable");
        }
    }
}
