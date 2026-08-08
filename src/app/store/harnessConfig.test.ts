// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { COMPOSE_HARNESS_ID, loadHarnessPrefs, persistHarnessPrefs } from "./harnessConfig";

/**
 * Carrying a selection made before providers existed.
 *
 * Ollama and OpenRouter were never separate agents — each was one `OpenHarness`
 * differing only in `base_url` and which environment variable holds the key.
 * Folding them into the built-in `compose` agent removes their ids from the
 * catalog, and the stale-agent guard in `resolveDefaultHarness` treats an
 * unknown id as unset and silently re-picks. Without a migration every existing
 * user loses their agent AND their model on upgrade, with no error to explain
 * it. These tests are the difference between an upgrade and a reset.
 */

const KEY = "compose.harnessPrefs";

function seed(prefs: Record<string, unknown>) {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}

describe("provider migration", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("moves an Ollama selection onto the compose agent, keeping the model", () => {
    seed({
      selectedHarnessId: "ollama",
      allowEdits: true,
      reviewEdits: false,
      customInstructions: "",
      harnessOptions: { ollama: { model: "gpt-oss:20b" } },
    });

    const prefs = loadHarnessPrefs();

    expect(prefs.selectedHarnessId).toBe(COMPOSE_HARNESS_ID);
    expect(prefs.selectedProviderId).toBe("ollama");
    // The model is the part users notice losing.
    expect(prefs.providerOptions.ollama?.model).toBe("gpt-oss:20b");
  });

  it("does the same for OpenRouter", () => {
    seed({
      selectedHarnessId: "openrouter",
      harnessOptions: { openrouter: { model: "openai/gpt-oss-120b" } },
    });

    const prefs = loadHarnessPrefs();

    expect(prefs.selectedHarnessId).toBe(COMPOSE_HARNESS_ID);
    expect(prefs.selectedProviderId).toBe("openrouter");
    expect(prefs.providerOptions.openrouter?.model).toBe("openai/gpt-oss-120b");
  });

  it("leaves a CLI agent alone", () => {
    // Claude Code is a real agent, not an endpoint. It must not be rewritten.
    seed({
      selectedHarnessId: "claude",
      harnessOptions: { claude: { model: "sonnet", maxTurns: 12 } },
    });

    const prefs = loadHarnessPrefs();

    expect(prefs.selectedHarnessId).toBe("claude");
    expect(prefs.selectedProviderId).toBe("");
    expect(prefs.harnessOptions.claude?.maxTurns).toBe(12);
    expect(prefs.providerOptions).toEqual({});
  });

  it("leaves a custom ACP agent alone", () => {
    // A user-supplied ACP command is its own agent. Only custom OpenAI-compatible
    // entries are endpoints.
    seed({ selectedHarnessId: "custom:acp:abc", harnessOptions: {} });

    expect(loadHarnessPrefs().selectedHarnessId).toBe("custom:acp:abc");
  });

  it("migrates a custom OpenAI-compatible agent, which was also an endpoint", () => {
    seed({
      selectedHarnessId: "custom:openai:xyz",
      harnessOptions: { "custom:openai:xyz": { model: "llama-3.1-70b" } },
    });

    const prefs = loadHarnessPrefs();

    expect(prefs.selectedHarnessId).toBe(COMPOSE_HARNESS_ID);
    expect(prefs.selectedProviderId).toBe("custom:openai:xyz");
    expect(prefs.providerOptions["custom:openai:xyz"]?.model).toBe("llama-3.1-70b");
  });

  it("survives a provider selection with no saved options", () => {
    // A user who picked Ollama but never chose a model.
    seed({ selectedHarnessId: "ollama", harnessOptions: {} });

    const prefs = loadHarnessPrefs();

    expect(prefs.selectedHarnessId).toBe(COMPOSE_HARNESS_ID);
    expect(prefs.selectedProviderId).toBe("ollama");
    expect(prefs.providerOptions).toEqual({});
  });

  it("keeps every other preference untouched while migrating", () => {
    seed({
      selectedHarnessId: "ollama",
      allowEdits: false,
      reviewEdits: true,
      customInstructions: "Write British English.",
      harnessOptions: { ollama: { model: "qwen3:4b" }, claude: { maxTurns: 5 } },
    });

    const prefs = loadHarnessPrefs();

    expect(prefs.allowEdits).toBe(false);
    expect(prefs.reviewEdits).toBe(true);
    expect(prefs.customInstructions).toBe("Write British English.");
    // Another agent's options are not collateral damage.
    expect(prefs.harnessOptions.claude?.maxTurns).toBe(5);
  });

  it("is idempotent — a second load does not re-migrate", () => {
    seed({ selectedHarnessId: "ollama", harnessOptions: { ollama: { model: "qwen3:4b" } } });

    persistHarnessPrefs(loadHarnessPrefs());
    const twice = loadHarnessPrefs();

    expect(twice.selectedHarnessId).toBe(COMPOSE_HARNESS_ID);
    expect(twice.selectedProviderId).toBe("ollama");
    expect(twice.providerOptions.ollama?.model).toBe("qwen3:4b");
  });

  it("leaves a fresh install unset, so boot can pick a ready agent", () => {
    const prefs = loadHarnessPrefs();

    expect(prefs.selectedHarnessId).toBe("");
    expect(prefs.selectedProviderId).toBe("");
  });
});
