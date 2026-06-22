//! Compose's harness set: the agent-harness built-ins plus the providers that
//! need host-supplied wiring (OpenRouter's endpoint + key, Ollama's local
//! server, OpenCode's ACP command).

use harness::{
    AcpHarness, Bob, Claude, Codex, Harness, HarnessInfo, HarnessReadiness, OpenHarness,
    OpenHarnessConfig, Registry,
};

fn openrouter() -> OpenHarness {
    OpenHarness::custom(OpenHarnessConfig {
        id: "openrouter".to_owned(),
        display_name: "OpenRouter".to_owned(),
        base_url: "https://openrouter.ai/api".to_owned(),
        api_key_env: Some("OPENROUTER_API_KEY".to_owned()),
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
    // User-registered agents rank after the built-in providers, before bob.
    for harness in crate::harness::custom::custom_agent_store().build_harnesses() {
        registry = registry.register_boxed(harness);
    }
    registry.register(Bob::new())
}

pub fn compose_harness_by_id(id: &str) -> Option<Box<dyn Harness>> {
    compose_registry().into_by_id(id)
}

pub fn compose_harness_catalog() -> Vec<HarnessInfo> {
    compose_registry().catalog()
}

/// Readiness of every registered harness — "what's actually on this machine."
pub fn compose_discover() -> Vec<HarnessReadiness> {
    compose_registry().discover()
}
