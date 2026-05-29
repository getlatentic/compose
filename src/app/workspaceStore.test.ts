import { beforeEach, describe, expect, it, vi } from "vitest";
import { runHarnessStream } from "../lib/ipc/bobClient";
import { recordLlmThread } from "../lib/ipc/llmContextClient";
import { checkBobInstall, getBobAuthStatus } from "../lib/ipc/settingsClient";
import { useWorkspaceStore } from "./workspaceStore";

vi.mock("../lib/ipc/filesClient", () => ({
  createFile: vi.fn(),
  deleteFile: vi.fn(),
  FileConflictError: class FileConflictError extends Error {},
  readFile: vi.fn(),
  renameFile: vi.fn(),
  scanWorkspace: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("../lib/ipc/commentsClient", () => ({
  loadWorkspaceComments: vi.fn(),
  saveWorkspaceComments: vi.fn(),
}));

vi.mock("../lib/ipc/indexClient", () => ({
  rebuildWorkspaceIndex: vi.fn(),
}));

vi.mock("../lib/ipc/llmContextClient", () => ({
  appendLlmMessage: vi.fn(),
  recordLlmThread: vi.fn(),
}));

vi.mock("../lib/ipc/settingsClient", () => ({
  checkBobInstall: vi.fn(),
  getBobAuthStatus: vi.fn(),
}));

vi.mock("../lib/ipc/workspaceClient", () => ({
  markWorkspaceOpened: vi.fn(),
  saveWorkspaceTabs: vi.fn(),
}));

vi.mock("../lib/ipc/bobClient", () => ({
  cancelHarnessRun: vi.fn(),
  runHarnessStream: vi.fn(),
  subscribeHarnessRun: vi.fn(),
  harnessList: vi.fn(async () => []),
  DEFAULT_HARNESS_ID: "bob",
}));

describe("workspace store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({
      activeWorkspaceId: null,
      bobAuthStatus: { configured: false },
      bobInstallStatus: null,
      chatOpen: true,
      harnessCatalog: [],
      harnessOptions: {},
      onboarding: {},
      saveError: null,
      selectedHarnessId: "bob",
      viewMode: "dashboard",
      workspaces: [],
    });
  });

  it("does not persist or spawn a Bob run before desktop runtime readiness passes", async () => {
    vi.mocked(getBobAuthStatus).mockResolvedValue({ configured: true });
    vi.mocked(checkBobInstall).mockResolvedValue({
      errorMessage: "Bob credentials and CLI checks require the Tauri desktop runtime.",
      installed: false,
      requiresDesktopRuntime: true,
    });

    useWorkspaceStore.getState().addWorkspace("/tmp/bob-vault");
    useWorkspaceStore.getState().setChatPrompt("Summarize this note");

    await useWorkspaceStore.getState().sendChatPrompt();

    const workspace = useWorkspaceStore.getState().activeWorkspace();

    expect(recordLlmThread).not.toHaveBeenCalled();
    expect(runHarnessStream).not.toHaveBeenCalled();
    expect(workspace?.chatThread.runState).toBe("error");
    expect(workspace?.chatThread.runError).toBe("Open the desktop app to run Bob.");
  });

  it("routes a non-bob harness to runHarnessStream without the bob credential preflight", async () => {
    // Codex (and Claude Code) authenticate through their own CLI login,
    // so the run must NOT be gated on bob's API key / install — that
    // gate is what produced "I selected Codex but it told me to connect
    // bob". A missing CLI login surfaces later as that harness's own
    // run error, not a bob-flavoured one.
    vi.mocked(recordLlmThread).mockResolvedValue({ llmThreadId: "llm-1" });

    useWorkspaceStore.setState({ selectedHarnessId: "codex" });
    useWorkspaceStore.getState().addWorkspace("/tmp/codex-vault");
    useWorkspaceStore.getState().setChatPrompt("Summarize this note");

    await useWorkspaceStore.getState().sendChatPrompt();

    expect(getBobAuthStatus).not.toHaveBeenCalled();
    expect(checkBobInstall).not.toHaveBeenCalled();
    expect(runHarnessStream).toHaveBeenCalledWith(
      expect.objectContaining({ harnessId: "codex" }),
    );
  });

  it("gates the credential preflight on capability, not the harness id", async () => {
    // A non-bob harness whose catalog entry declares credentialRequired
    // must trigger the SAME preflight as bob — proving the gate reads
    // capabilities, not `id === "bob"`.
    vi.mocked(getBobAuthStatus).mockResolvedValue({ configured: true });
    vi.mocked(checkBobInstall).mockResolvedValue({
      errorMessage: "requires the Tauri desktop runtime.",
      installed: false,
      requiresDesktopRuntime: true,
    });
    useWorkspaceStore.setState({
      selectedHarnessId: "acme",
      harnessCatalog: [
        {
          id: "acme",
          displayName: "Acme",
          description: "",
          requiresInstall: false,
          capabilities: {
            credentialRequired: true,
            previewsEdits: false,
            models: [],
            allowsCustomModel: false,
            supportsEffort: false,
            supportsMaxTurns: false,
            supportsLogin: false,
          },
        },
      ],
    });
    useWorkspaceStore.getState().addWorkspace("/tmp/acme-vault");
    useWorkspaceStore.getState().setChatPrompt("hello");

    await useWorkspaceStore.getState().sendChatPrompt();

    expect(getBobAuthStatus).toHaveBeenCalled();
    expect(runHarnessStream).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeWorkspace()?.chatThread.runState).toBe("error");
  });

  it("forwards the selected harness's persisted model + tuning on a run", async () => {
    // The Settings picker stores per-harness model/effort/turn options;
    // a run must carry the *selected* harness's options through to
    // runHarnessStream so the adapter can map them onto CLI flags.
    vi.mocked(recordLlmThread).mockResolvedValue({ llmThreadId: "llm-1" });

    useWorkspaceStore.setState({
      selectedHarnessId: "codex",
      harnessOptions: { codex: { model: "gpt-5-codex", effort: "high" } },
    });
    useWorkspaceStore.getState().addWorkspace("/tmp/codex-vault");
    useWorkspaceStore.getState().setChatPrompt("Summarize this note");

    await useWorkspaceStore.getState().sendChatPrompt();

    expect(runHarnessStream).toHaveBeenCalledWith(
      expect.objectContaining({ harnessId: "codex", model: "gpt-5-codex", effort: "high" }),
    );
  });

  it("routes ask-about-selection to a non-bob harness without the bob credential preflight", async () => {
    // The "ask about this selection" flow used to gate unconditionally
    // on bob's cached readiness: with a non-bob harness selected AND bob
    // not configured (the default state here), it popped open Settings
    // with "Connect your Bob API key" and never ran the chosen harness.
    // Now it mirrors sendChatPrompt — the bob preflight is bob-only, so
    // the run routes straight to runHarnessStream as a read-only "ask".
    useWorkspaceStore.setState({ selectedHarnessId: "codex" });
    useWorkspaceStore.getState().addWorkspace("/tmp/codex-vault");

    await useWorkspaceStore.getState().askBobAboutSelectionStream("What does this do?", {
      range: { start: 0, end: 4 },
      text: "todo",
    });

    expect(getBobAuthStatus).not.toHaveBeenCalled();
    expect(checkBobInstall).not.toHaveBeenCalled();
    expect(runHarnessStream).toHaveBeenCalledWith(
      expect.objectContaining({ harnessId: "codex", chatMode: "ask" }),
    );
    // The bob "not connected" gate did not fire: no error, no Settings pane.
    const workspace = useWorkspaceStore.getState().activeWorkspace();
    expect(workspace?.chatThread.runState).not.toBe("error");
    expect(workspace?.chatThread.runError).toBeNull();
    expect(workspace?.openPanes.some((pane) => pane.kind === "settings") ?? false).toBe(false);
  });
});
