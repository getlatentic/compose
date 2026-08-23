// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DependencyStatus } from "../../lib/ipc/systemClient";

const systemReadiness = vi.fn<() => Promise<DependencyStatus[]>>();
vi.mock("../../lib/ipc/systemClient", () => ({
  systemReadiness: (...args: []) => systemReadiness(...args),
}));
const isTauriRuntime = vi.fn(() => true);
vi.mock("../../lib/runtime/desktopRuntime", () => ({
  isTauriRuntime: () => isTauriRuntime(),
}));

import { useSystemStore } from "../../app/store/systemStore";
import { SystemSetupPanel } from "./SystemSetupPanel";

function ollama(present: boolean, version: string | null = null): DependencyStatus {
  return {
    id: "ollama",
    name: "Ollama (local AI)",
    description: "Runs AI models privately on your Mac.",
    present,
    version,
    hint: { url: "https://ollama.com/download", command: null },
  };
}

describe("the Local AI panel — detect and hand off, never install", () => {
  beforeEach(() => {
    useSystemStore.setState({ statuses: [], loaded: false });
    systemReadiness.mockReset();
    systemReadiness.mockResolvedValue([]);
    isTauriRuntime.mockReturnValue(true);
  });
  afterEach(cleanup);

  it("hands a missing Ollama to the official download", async () => {
    systemReadiness.mockResolvedValue([ollama(false)]);
    render(<SystemSetupPanel />);

    expect(await screen.findByText("Not installed")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Get it" });
    expect(link.getAttribute("href")).toBe("https://ollama.com/download");
    // The old panel installed; this one must not offer to.
    expect(screen.queryByRole("button", { name: /install|set up/i })).toBeNull();
  });

  it("shows the detected version once it is installed", async () => {
    systemReadiness.mockResolvedValue([ollama(true, "0.9.2")]);
    render(<SystemSetupPanel />);

    expect(await screen.findByText("Installed · 0.9.2")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Get it" })).toBeNull();
  });

  it("Recheck re-probes — the user installs outside, Compose picks it up", async () => {
    systemReadiness.mockResolvedValueOnce([ollama(false)]);
    render(<SystemSetupPanel />);
    expect(await screen.findByText("Not installed")).toBeTruthy();

    systemReadiness.mockResolvedValueOnce([ollama(true, "0.9.2")]);
    await userEvent.click(screen.getByRole("button", { name: "Recheck" }));

    expect(await screen.findByText("Installed · 0.9.2")).toBeTruthy();
  });

  it("stays quiet in the browser preview", () => {
    isTauriRuntime.mockReturnValue(false);
    render(<SystemSetupPanel />);
    expect(screen.getByText("Desktop only")).toBeTruthy();
  });
});
