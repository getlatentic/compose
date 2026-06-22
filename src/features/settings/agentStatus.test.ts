import { describe, expect, it } from "vitest";

import { agentStatus } from "./agentStatus";
import type { HarnessCapabilities, HarnessInfo, HarnessReadiness } from "../../lib/ipc/harnessClient";

const caps = (over: Partial<HarnessCapabilities> = {}): HarnessCapabilities => ({
  credentialRequired: false,
  previewsEdits: false,
  models: [],
  allowsCustomModel: false,
  supportsEffort: false,
  supportsMaxTurns: false,
  supportsLogin: false,
  supportsCustomInstructions: false,
  ...over,
});

const info = (
  over: Partial<Omit<HarnessInfo, "capabilities">> & { capabilities?: Partial<HarnessCapabilities> } = {},
): HarnessInfo => ({
  id: "x",
  displayName: "X",
  description: "",
  requiresInstall: false,
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
      info({ requiresInstall: true, capabilities: { supportsLogin: true } }),
      readiness({ installed: true, ready: false }),
    );
    expect(status.kind).toBe("needsSignIn");
    expect(status.action).toBe("signIn");
  });

  it("a CLI that isn't on disk says 'Not installed' before any auth state", () => {
    const status = agentStatus(
      info({ requiresInstall: true, capabilities: { supportsLogin: true } }),
      readiness({ installed: false }),
    );
    expect(status.kind).toBe("notInstalled");
    expect(status.action).toBe("install");
  });

  it("a managed agent installed without its key says 'Add a key' (install step already done)", () => {
    // Bob: requiresInstall + credentialRequired.
    const status = agentStatus(
      info({ requiresInstall: true, capabilities: { credentialRequired: true } }),
      readiness({ installed: true, ready: false }),
    );
    expect(status.kind).toBe("needsKey");
  });
});
