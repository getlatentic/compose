import { describe, expect, it } from "vitest";

import type { HarnessInfo } from "../../lib/ipc/harnessClient";
import { groupAgents, isBuiltInProvider, isLocalProvider, selectionLabel } from "./agentGroups";

/** A catalog entry as the backend emits it: the classification is a field, and
 *  the id is opaque. The previous fixture invented `custom:openai:<name>` ids,
 *  which is why the grouping bug passed its own tests — the backend assigns
 *  `custom:<uuid>` and nothing downstream can read a kind off it. */
const info = (
  id: string,
  displayName = id,
  provider: HarnessInfo["provider"] = null,
): HarnessInfo => ({
  id,
  displayName,
  provider,
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
const LOCAL = { local: true };
const HOSTED = { local: false };

const CATALOG = [
  info("ollama", "Ollama", LOCAL),
  info("claude", "Claude Code"),
  info("codex", "Codex"),
  info("openrouter", "OpenRouter", HOSTED),
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

  it("files a user-added endpoint with the providers, whatever its id", () => {
    // The reported bug. A registered endpoint gets an opaque `custom:<uuid>`,
    // so nothing about the id says which kind it is — and an LM Studio the user
    // added landed under "Other agents", beside Claude Code, as though it
    // brought its own agent loop.
    const groups = groupAgents([
      info("custom:8dae64f0-af60-4172-b421-77bf6c94aa56", "LM Studio", LOCAL),
      info("custom:2b1f0c33-9e77-4a10-8c55-1d0b0a9e77aa", "My ACP agent"),
    ]);
    expect(groups[0].label).toBe("Compose");
    expect(groups[0].entries.map((e) => e.displayName)).toEqual(["LM Studio"]);
    expect(groups[1].entries.map((e) => e.displayName)).toEqual(["My ACP agent"]);
  });

  it("never rewrites an id — a run is started with it", () => {
    // The whole reason this is display-only: `selectedHarnessId` goes straight
    // to the IPC layer. Grouping that changed ids would break every run.
    const ids = groupAgents(CATALOG).flatMap((g) => g.entries.map((e) => e.id));
    expect(ids.sort()).toEqual(CATALOG.map((e) => e.id).sort());
  });
});

describe("classifying a provider", () => {
  it("reads the classification, never the id", () => {
    expect(isBuiltInProvider(info("ollama", "Ollama", LOCAL))).toBe(true);
    expect(isBuiltInProvider(info("openrouter", "OpenRouter", HOSTED))).toBe(true);
    expect(isBuiltInProvider(info("custom:uuid", "LM Studio", LOCAL))).toBe(true);
    expect(isBuiltInProvider(info("claude", "Claude Code"))).toBe(false);
    expect(isBuiltInProvider(info("custom:uuid", "An ACP agent"))).toBe(false);
  });

  it("marks a user's local endpoint as local, not just the shipped one", () => {
    // An LM Studio or llama.cpp on this machine is as local as Ollama; the old
    // check hardcoded the one id we happened to ship.
    expect(isLocalProvider(info("custom:uuid", "LM Studio", LOCAL))).toBe(true);
    expect(isLocalProvider(info("ollama", "Ollama", LOCAL))).toBe(true);
    expect(isLocalProvider(info("openrouter", "OpenRouter", HOSTED))).toBe(false);
    expect(isLocalProvider(info("claude", "Claude Code"))).toBe(false);
  });
});

describe("the footer label", () => {
  it("shows the built-in agent's name, not the provider's", () => {
    // `Compose / OpenRouter / claude-sonnet-4` spends three slots on a
    // two-slot decision.
    const label = selectionLabel(info("openrouter", "OpenRouter", HOSTED), "openai/gpt-oss-120b");
    expect(label.agent).toBe("Compose");
    expect(label.model).toBe("openai/gpt-oss-120b");
    expect(label.local).toBe(false);
  });

  it("marks a local provider, so cost and privacy read at a glance", () => {
    expect(selectionLabel(info("ollama", "Ollama", LOCAL), "gpt-oss:20b").local).toBe(true);
  });

  it("shows a standalone agent under its own name", () => {
    const label = selectionLabel(info("claude", "Claude Code"), "sonnet");
    expect(label.agent).toBe("Claude Code");
    expect(label.local).toBe(false);
  });

  it("copes with no model chosen yet", () => {
    expect(selectionLabel(info("ollama", "Ollama", LOCAL), undefined).model).toBeNull();
    expect(selectionLabel(info("ollama", "Ollama", LOCAL), "   ").model).toBeNull();
  });

  it("copes with no agent selected", () => {
    expect(selectionLabel(undefined, undefined).agent).toBe("No agent");
  });
});
