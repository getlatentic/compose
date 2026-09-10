// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/ipc/workspaceClient", () => ({
  // Never settles: everything asserted below happens on the first render,
  // before any of the boot fan-out could have answered.
  listWorkspaces: vi.fn(() => new Promise(() => {})),
  getOnboarding: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../lib/ipc/externalFilesClient", () => ({
  externalList: vi.fn(() => new Promise(() => {})),
  externalAdd: vi.fn(),
  externalRemove: vi.fn(),
}));
vi.mock("../lib/ipc/harnessClient", () => ({
  harnessList: vi.fn(() => new Promise(() => {})),
  harnessListModels: vi.fn(() => new Promise(() => {})),
  harnessModelManagement: vi.fn(() => new Promise(() => {})),
  harnessReadiness: vi.fn(() => new Promise(() => {})),
  ollamaInstalled: vi.fn(() => new Promise(() => {})),
  startOllama: vi.fn(() => new Promise(() => {})),
}));
vi.mock("./MainApp", () => ({
  MainApp: () => <div data-testid="main-app" />,
}));
vi.mock("../features/setup/SetupScreen", () => ({
  SetupScreen: () => <div data-testid="setup-screen" />,
}));

const WORKSPACE_ID = "11111111-2222-3333-4444-555555555555";

const PAYLOAD = {
  workspaces: {
    activeWorkspaceId: WORKSPACE_ID,
    onboarding: { completedAt: 1700000000000 },
    workspaces: [
      {
        id: WORKSPACE_ID,
        name: "Notes",
        path: "/vault",
        tabs: { activeFilePath: "note.md", openFilePaths: ["note.md"] },
      },
    ],
  },
  files: [{ relativePath: "note.md", lastModifiedMs: 10, sizeBytes: 6 }],
  activeFile: {
    workspaceId: WORKSPACE_ID,
    relativePath: "note.md",
    content: "# Note",
    lastModifiedMs: 10,
  },
  externalFiles: null,
};

async function renderRouter(payload: unknown) {
  vi.resetModules();
  if (payload === undefined) {
    delete (window as { __COMPOSE_BOOT__?: unknown }).__COMPOSE_BOOT__;
  } else {
    (window as { __COMPOSE_BOOT__?: unknown }).__COMPOSE_BOOT__ = payload;
  }
  const { AppRouter } = await import("./AppRouter");
  render(<AppRouter />);
}


afterEach(() => {
  delete (window as { __COMPOSE_BOOT__?: unknown }).__COMPOSE_BOOT__;
});

describe("the first render of a launch", () => {
  it("is the app itself when the payload already answered the boot questions", async () => {
    await renderRouter(PAYLOAD);

    expect(screen.getByTestId("main-app")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  // The control: without a payload the same render must still be the splash,
  // or the assertion above would pass for a router that never splashes at all.
  it("is the splash when it has to ask", async () => {
    await renderRouter(undefined);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByTestId("main-app")).toBeNull();
  });

});
