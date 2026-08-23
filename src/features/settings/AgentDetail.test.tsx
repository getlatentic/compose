// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HarnessInfo, HarnessReadiness } from "../../lib/ipc/harnessClient";

// The heavy children are IPC-connected and irrelevant here; each renders a
// marker so the test can assert which sections the page decided to show.
vi.mock("./agentConfigControls", () => ({
  HarnessCredentialForm: () => null,
  ModelSection: () => null,
}));
vi.mock("./AdvancedRunOptions", () => ({
  AdvancedRunOptions: () => null,
  hasAdvancedRunOptions: () => false,
}));
vi.mock("./RuntimeDetailPanel", () => ({ RuntimeDetailPanel: () => null }));
vi.mock("./OllamaModelManager", () => ({
  OllamaModelManager: () => <div data-testid="model-manager" />,
}));
const setup = { readiness: null as HarnessReadiness | null };
vi.mock("./useHarnessSetup", () => ({ useHarnessSetup: () => setup }));
vi.mock("../../lib/ipc/harnessClient", () => ({
  harnessRemoveCustom: vi.fn(),
  // The store probes this on mount; the seeded state already says true.
  harnessModelManagement: vi.fn(async () => ({ baseUrl: "http://localhost:11434" })),
}));

import { useHarnessStore } from "../../app/store/harnessStore";
import { AgentDetail } from "./AgentDetail";

const OLLAMA: HarnessInfo = {
  id: "ollama",
  displayName: "Ollama",
  description: "",
  installHint: { url: "https://ollama.com/download", command: null },
  capabilities: {
    credentialRequired: false,
    previewsEdits: false,
    models: [],
    customModel: true,
    effort: false,
    maxTurns: false,
    login: false,
    customInstructions: true,
  },
};

function readiness(ready: boolean, installed: boolean): HarnessReadiness {
  return {
    harnessId: "ollama",
    ready,
    installed,
    version: null,
    authConfigured: ready,
    error: ready ? null : "Ollama is not reachable",
    details: null,
  };
}

describe("AgentDetail — a local agent that isn't on the machine", () => {
  beforeEach(() => {
    useHarnessStore.setState({
      harnessCatalog: [OLLAMA],
      selectedHarnessId: "ollama",
      harnessModelManagement: { ollama: { baseUrl: "http://localhost:11434" } },
    });
  });
  afterEach(cleanup);

  it("offers the install hand-off and no model manager", () => {
    // The contradiction this replaces: under "Ollama isn't installed" sat an
    // "Installed models" section whose probe read its own failure as "not
    // running", so it spun for a server that was never coming.
    setup.readiness = readiness(false, false);
    render(<AgentDetail agentId="ollama" onBack={() => {}} />);

    expect(screen.getByText(/isn.t installed/)).toBeTruthy();
    expect(screen.queryByTestId("model-manager")).toBeNull();
  });

  it("keeps the model manager when it is installed but stopped", () => {
    // Still the right place to look: the server is just down, and the manager
    // recovers on its own once it is up.
    setup.readiness = readiness(false, true);
    render(<AgentDetail agentId="ollama" onBack={() => {}} />);

    expect(screen.getByTestId("model-manager")).toBeTruthy();
  });

  it("keeps the model manager when it is ready", () => {
    setup.readiness = readiness(true, true);
    render(<AgentDetail agentId="ollama" onBack={() => {}} />);

    expect(screen.getByTestId("model-manager")).toBeTruthy();
  });
});
