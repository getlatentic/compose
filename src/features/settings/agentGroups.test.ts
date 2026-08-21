import { describe, expect, it } from "vitest";

import type { HarnessInfo } from "../../lib/ipc/harnessClient";
import { groupAgents, isBuiltInProvider, isLocalProvider, selectionLabel } from "./agentGroups";

const info = (id: string, displayName = id): HarnessInfo => ({
  id,
  displayName,
  description: "",
  installHint: null,
  capabilities: {
    credentialRequired: false,
    previewsEdits: false,
    models: [],
    customModel: true,
    effort: false,
    maxTurns: false,
    login: false,
    customInstructions: false,
  },
});

/** The catalog in registration order, which is also recommendation order. */
const CATALOG = [
  info("ollama", "Ollama"),
  info("claude", "Claude Code"),
  info("codex", "Codex"),
  info("openrouter", "OpenRouter"),
  info("opencode", "OpenCode"),
];

describe("grouping the catalog", () => {
  it("puts the OpenAI-compatible endpoints under the built-in agent", () => {
    const groups = groupAgents(CATALOG);

    expect(groups.map((g) => g.label)).toEqual(["Compose", "Other agents"]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["ollama", "openrouter"]);
    expect(groups[1].entries.map((e) => e.id)).toEqual(["claude", "codex", "opencode"]);
  });

  it("keeps the backend's order inside each group", () => {
    // Registration order is the recommendation order — Ollama leads because it
    // is the local-first pick. Grouping must not reshuffle it.
    const groups = groupAgents(CATALOG);
    expect(groups[0].entries[0].id).toBe("ollama");
    expect(groups[1].entries[0].id).toBe("claude");
  });

  it("does not invent an empty group", () => {
    // A build without `openai-compatible` has no providers at all.
    const groups = groupAgents([info("claude"), info("codex")]);
    expect(groups.map((g) => g.label)).toEqual(["Other agents"]);
  });

  it("treats a custom OpenAI endpoint as a provider, a custom ACP agent as an agent", () => {
    const groups = groupAgents([info("custom:openai:x"), info("custom:acp:y")]);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["custom:openai:x"]);
    expect(groups[1].entries.map((e) => e.id)).toEqual(["custom:acp:y"]);
  });

  it("never rewrites an id — a run is started with it", () => {
    // The whole reason this is display-only: `selectedHarnessId` goes straight
    // to the IPC layer. Grouping that changed ids would break every run.
    const ids = groupAgents(CATALOG).flatMap((g) => g.entries.map((e) => e.id));
    expect(ids.sort()).toEqual(CATALOG.map((e) => e.id).sort());
  });
});

describe("classifying a provider", () => {
  it("recognises the built-in providers", () => {
    expect(isBuiltInProvider("ollama")).toBe(true);
    expect(isBuiltInProvider("openrouter")).toBe(true);
    expect(isBuiltInProvider("custom:openai:abc")).toBe(true);
    expect(isBuiltInProvider("claude")).toBe(false);
    expect(isBuiltInProvider("custom:acp:abc")).toBe(false);
  });

  it("knows which one serves models from this machine", () => {
    expect(isLocalProvider("ollama")).toBe(true);
    expect(isLocalProvider("openrouter")).toBe(false);
  });
});

describe("the footer label", () => {
  it("shows the built-in agent's name, not the provider's", () => {
    // `Compose / OpenRouter / claude-sonnet-4` spends three slots on a
    // two-slot decision.
    const label = selectionLabel(info("openrouter", "OpenRouter"), "openai/gpt-oss-120b");
    expect(label.agent).toBe("Compose");
    expect(label.model).toBe("openai/gpt-oss-120b");
    expect(label.local).toBe(false);
  });

  it("marks a local provider, so cost and privacy read at a glance", () => {
    expect(selectionLabel(info("ollama", "Ollama"), "gpt-oss:20b").local).toBe(true);
  });

  it("shows a standalone agent under its own name", () => {
    const label = selectionLabel(info("claude", "Claude Code"), "sonnet");
    expect(label.agent).toBe("Claude Code");
    expect(label.local).toBe(false);
  });

  it("copes with no model chosen yet", () => {
    expect(selectionLabel(info("ollama", "Ollama"), undefined).model).toBeNull();
    expect(selectionLabel(info("ollama", "Ollama"), "   ").model).toBeNull();
  });

  it("copes with no agent selected", () => {
    expect(selectionLabel(undefined, undefined).agent).toBe("No agent");
  });
});
