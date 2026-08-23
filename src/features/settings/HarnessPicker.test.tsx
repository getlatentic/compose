// @vitest-environment jsdom
//
// The agent picker end to end: it loads its rows in an effect, so a static
// render only ever sees the empty state. These use React Testing Library
// (jsdom tier) because what is under test is effect-driven data flow, not
// layout — the browser tier stays for geometry and caret work per ADR 0001.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  harnessList: vi.fn(),
  harnessDiscover: vi.fn(),
  harnessLogin: vi.fn(),
}));
vi.mock("../../lib/ipc/harnessClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/ipc/harnessClient")>();
  return { ...original, ...ipc };
});

const { HarnessPicker } = await import("./HarnessPicker");
const { useHarnessStore } = await import("../../app/store/harnessStore");

function agent(over: Record<string, unknown> = {}) {
  return {
    id: "claude",
    displayName: "Claude Code",
    description: "Anthropic's agent CLI.",
    installHint: null,
    capabilities: {
      credentialRequired: false,
      previewsEdits: false,
      models: [],
      customModel: false,
      effort: false,
      maxTurns: false,
      login: true,
      customInstructions: false,
    },
    ...over,
  };
}

function readiness(over: Record<string, unknown> = {}) {
  return {
    harnessId: "claude",
    ready: true,
    installed: true,
    version: "2.1.0",
    authConfigured: true,
    error: null,
    details: null,
    ...over,
  };
}

beforeEach(() => {
  ipc.harnessList.mockReset();
  ipc.harnessDiscover.mockReset();
  useHarnessStore.setState({ selectedHarnessId: "claude", selectedHarnessReadiness: null });
});
afterEach(cleanup);

describe("what the picker tells you about each agent", () => {
  it("shows an agent that is ready, with the version it found", async () => {
    ipc.harnessList.mockResolvedValue([agent()]);
    ipc.harnessDiscover.mockResolvedValue([readiness()]);

    render(<HarnessPicker />);

    expect(await screen.findByText("Claude Code")).toBeDefined();
    await waitFor(() => expect(screen.getByText("2.1.0")).toBeDefined());
  });

  it("offers somewhere to get an agent that is missing, instead of a dead end", async () => {
    // Compose runs agents and does not install them, so "Not installed" with no
    // next step is the regression the install hint exists to prevent.
    ipc.harnessList.mockResolvedValue([
      agent({ installHint: { url: "https://example.test/install", command: "brew install thing" } }),
    ]);
    ipc.harnessDiscover.mockResolvedValue([
      readiness({ ready: false, installed: false, version: null, authConfigured: false }),
    ]);

    render(<HarnessPicker />);

    await waitFor(() => expect(screen.getByText(/brew install thing/)).toBeDefined());
  });

  it("offers sign-in for an agent that is installed but signed out", async () => {
    // The other half: an installed agent needs a sign-in button, not an
    // install hint — telling someone to install what they already have is the
    // wrong next step.
    ipc.harnessList.mockResolvedValue([agent()]);
    ipc.harnessDiscover.mockResolvedValue([
      readiness({ ready: false, authConfigured: false, error: "not signed in" }),
    ]);

    render(<HarnessPicker />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sign in" })).toBeDefined(),
    );
    expect(screen.queryByText(/brew install/)).toBeNull();
  });

  it("says what went wrong when the probe itself fails", async () => {
    // A rejected probe used to leave the panel on "Checking…" forever.
    ipc.harnessList.mockRejectedValue(new Error("registry unavailable"));
    ipc.harnessDiscover.mockResolvedValue([]);

    render(<HarnessPicker />);

    await waitFor(() => expect(screen.getByText(/registry unavailable/)).toBeDefined());
  });

  it("marks the selected agent as pressed, and only that one", async () => {
    ipc.harnessList.mockResolvedValue([agent(), agent({ id: "codex", displayName: "Codex" })]);
    ipc.harnessDiscover.mockResolvedValue([readiness(), readiness({ harnessId: "codex" })]);

    render(<HarnessPicker />);

    await waitFor(() => expect(screen.getByText("Codex")).toBeDefined());
    const pressed = screen
      .getAllByRole("button", { pressed: true })
      .map((node) => node.textContent ?? "");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toContain("Claude Code");
  });
});
