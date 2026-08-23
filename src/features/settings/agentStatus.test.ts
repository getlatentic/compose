import { describe, expect, it } from "vitest";

import { agentStatus } from "./agentStatus";
import type { HarnessCapabilities, HarnessInfo, HarnessReadiness } from "../../lib/ipc/harnessClient";

const caps = (over: Partial<HarnessCapabilities> = {}): HarnessCapabilities => ({
  credentialRequired: false,
  previewsEdits: false,
  models: [],
  customModel: false,
  effort: false,
  maxTurns: false,
  login: false,
  customInstructions: false,
  ...over,
});

const HINT = { url: "https://example.dev/install", command: "npm i -g x" };

const info = (
  over: Partial<Omit<HarnessInfo, "capabilities">> & { capabilities?: Partial<HarnessCapabilities> } = {},
): HarnessInfo => ({
  id: "x",
  displayName: "X",
  description: "",
  installHint: null,
  provider: null,
  ...over,
  capabilities: caps(over.capabilities),
});

const readiness = (over: Partial<HarnessReadiness> = {}): HarnessReadiness => ({
  harnessId: "x",
  ready: false,
  installed: false,
  version: null,
  authConfigured: false,
  error: null,
  details: null,
  ...over,
});

describe("agentStatus", () => {
  it("reports a ready agent as Ready", () => {
    expect(agentStatus(info(), readiness({ ready: true })).kind).toBe("ready");
  });

  it("a local server that's installed but down is 'Not running', not 'Needs sign-in'", () => {
    // Ollama: no login, no key. The old catch-all mislabelled this as sign-in.
    const status = agentStatus(info(), readiness({ installed: true, ready: false }));
    expect(status.kind).toBe("notRunning");
    expect(status.label).toBe("Not running");
    expect(status.action).toBeUndefined();
  });

  it("a key-backed provider without its key says 'Add a key', not 'Needs sign-in'", () => {
    // OpenRouter: credentialRequired, no login.
    const status = agentStatus(
      info({ capabilities: { credentialRequired: true } }),
      readiness({ installed: true, ready: false }),
    );
    expect(status.kind).toBe("needsKey");
    expect(status.action).toBe("addKey");
  });

  it("an OAuth CLI that's installed but not signed in says 'Needs sign-in'", () => {
    const status = agentStatus(
      info({ installHint: HINT, capabilities: { login: true } }),
      readiness({ installed: true, ready: false }),
    );
    expect(status.kind).toBe("needsSignIn");
    expect(status.action).toBe("signIn");
  });

  it("a CLI that isn't on disk says 'Not installed' before any auth state", () => {
    const status = agentStatus(
      info({ installHint: HINT, capabilities: { login: true } }),
      readiness({ installed: false }),
    );
    expect(status.kind).toBe("notInstalled");
    // Compose doesn't install agents, so there is no button to offer — the
    // hint is what the row renders instead.
    expect(status.action).toBeUndefined();
  });

  it("a missing agent with no hint falls through to its auth state", () => {
    // A user-supplied ACP command: nowhere to send them, so "Not installed"
    // would be a dead end. Its real blocker is surfaced instead.
    const status = agentStatus(
      info({ installHint: null, capabilities: { credentialRequired: true } }),
      readiness({ installed: false, ready: false }),
    );
    expect(status.kind).toBe("needsKey");
  });
});
