import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runHarnessStream } from "../lib/ipc/bobClient";
import { recordLlmThread } from "../lib/ipc/llmContextClient";
import { checkBobInstall, getBobAuthStatus } from "../lib/ipc/settingsClient";
import {
  newConversation,
  saveConversation,
  _resetFallbackConversationsForTests,
  type ConversationMessageRecord,
} from "../lib/ipc/conversationsClient";
import { editGuardFor, reviewChangeToDraft, useWorkspaceStore } from "./workspaceStore";
import type { HarnessCapabilities } from "../lib/ipc/bobClient";
import { FileConflictError, readFile, writeFile } from "../lib/ipc/filesClient";

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
  // Both return Promise<void> in real life; `persistTabs` chains `.catch` on
  // the result, so the mocks must resolve rather than return undefined.
  markWorkspaceOpened: vi.fn(() => Promise.resolve()),
  saveWorkspaceTabs: vi.fn(() => Promise.resolve()),
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
    _resetFallbackConversationsForTests();
    useWorkspaceStore.setState({
      activeWorkspaceId: null,
      bobAuthStatus: { configured: false },
      bobInstallStatus: null,
      chatOpen: true,
      conversations: {},
      conversationDeleteNotice: null,
      harnessCatalog: [],
      harnessOptions: {},
      onboarding: {},
      saveError: null,
      selectedHarnessId: "bob",
      viewMode: "dashboard",
      workspaces: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it("forwards the selected harness's persisted model + tuning on an ask-about-selection run", () => {
    // Symmetric to the sendChatPrompt tuning test: the "ask about this
    // selection" flow must also carry the *selected* harness's persisted
    // model/effort through to runHarnessStream (as a read-only "ask"), so
    // the adapter maps them onto the same CLI flags a chat run would.
    vi.mocked(recordLlmThread).mockResolvedValue({ llmThreadId: "llm-1" });

    useWorkspaceStore.setState({
      selectedHarnessId: "codex",
      harnessOptions: { codex: { model: "gpt-5-codex", effort: "high" } },
    });
    useWorkspaceStore.getState().addWorkspace("/tmp/codex-vault");

    return useWorkspaceStore
      .getState()
      .askBobAboutSelectionStream("question", { range: { start: 0, end: 4 }, text: "todo" })
      .then(() => {
        expect(runHarnessStream).toHaveBeenCalledWith(
          expect.objectContaining({
            harnessId: "codex",
            chatMode: "ask",
            model: "gpt-5-codex",
            effort: "high",
          }),
        );
      });
  });

  describe("conversation management", () => {
    const userMsg = (content: string): ConversationMessageRecord => ({
      messageId: `m-${content.replace(/\s+/g, "-")}`,
      role: "user",
      content,
      createdAt: 0,
    });

    // Seed N conversations directly through the (browser-fallback) client and
    // sync them into the store. Returns their ids in creation order.
    async function seed(workspaceId: string, prompts: string[]): Promise<string[]> {
      const ids: string[] = [];
      for (const prompt of prompts) {
        const id = await newConversation(workspaceId, "bob");
        await saveConversation(workspaceId, id, [userMsg(prompt)], []);
        ids.push(id);
      }
      await useWorkspaceStore.getState().loadConversations(workspaceId);
      return ids;
    }

    it("newChat clears the thread without creating a conversation in history", async () => {
      const ws = useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      await useWorkspaceStore.getState().loadConversations(ws);
      expect(useWorkspaceStore.getState().conversations[ws] ?? []).toHaveLength(0);

      await useWorkspaceStore.getState().newChat();

      await useWorkspaceStore.getState().loadConversations(ws);
      expect(useWorkspaceStore.getState().conversations[ws] ?? []).toHaveLength(0);
      expect(
        useWorkspaceStore.getState().activeWorkspace()?.chatThread.conversationId,
      ).toBeNull();
    });

    it("creates a conversation on first send and lists it with a derived title", async () => {
      vi.mocked(recordLlmThread).mockResolvedValue({ llmThreadId: "llm-1" });
      const ws = useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      useWorkspaceStore.setState({ selectedHarnessId: "codex" });
      useWorkspaceStore.getState().setChatPrompt("Plan the Q3 relocation");

      await useWorkspaceStore.getState().sendChatPrompt();
      await useWorkspaceStore.getState().loadConversations(ws);

      const list = useWorkspaceStore.getState().conversations[ws] ?? [];
      expect(list).toHaveLength(1);
      expect(list[0].title).toBe("Plan the Q3 relocation");
      expect(useWorkspaceStore.getState().activeWorkspace()?.chatThread.conversationId).toBe(
        list[0].conversationId,
      );
    });

    it("opens a conversation, hydrating its thread and making it active", async () => {
      const ws = useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      const [c1, c2] = await seed(ws, ["first chat", "second chat"]);

      await useWorkspaceStore.getState().openConversation(c1);

      const thread = useWorkspaceStore.getState().activeWorkspace()?.chatThread;
      expect(thread?.conversationId).toBe(c1);
      expect(thread?.messages.map((m) => m.content)).toContain("first chat");
      expect(c2).not.toBe(c1);
    });

    it("renames a conversation optimistically", async () => {
      const ws = useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      const [c1] = await seed(ws, ["original prompt"]);

      await useWorkspaceStore.getState().renameConversation(c1, "My title");

      const entry = (useWorkspaceStore.getState().conversations[ws] ?? []).find(
        (c) => c.conversationId === c1,
      );
      expect(entry?.title).toBe("My title");
    });

    it("archiving the open conversation opens the next one", async () => {
      const ws = useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      const [c1, c2] = await seed(ws, ["one", "two"]);
      await useWorkspaceStore.getState().openConversation(c1);

      await useWorkspaceStore.getState().archiveConversation(c1, true);

      const list = useWorkspaceStore.getState().conversations[ws] ?? [];
      expect(list.find((c) => c.conversationId === c1)?.archived).toBe(true);
      expect(useWorkspaceStore.getState().activeWorkspace()?.chatThread.conversationId).toBe(c2);
    });

    it("soft-deletes with a grace window and restores on undo", async () => {
      const ws = useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      const [c1, c2] = await seed(ws, ["keep", "remove"]);

      useWorkspaceStore.getState().deleteConversation(c2);
      expect(
        (useWorkspaceStore.getState().conversations[ws] ?? []).some(
          (c) => c.conversationId === c2,
        ),
      ).toBe(false);
      expect(useWorkspaceStore.getState().conversationDeleteNotice?.conversationId).toBe(c2);

      useWorkspaceStore.getState().undoDeleteConversation(c2);
      await useWorkspaceStore.getState().loadConversations(ws);
      expect(
        (useWorkspaceStore.getState().conversations[ws] ?? []).some(
          (c) => c.conversationId === c2,
        ),
      ).toBe(true);
      expect(useWorkspaceStore.getState().conversationDeleteNotice).toBeNull();
      expect(c1).toBeTruthy();
    });

    it("commits the delete after the grace window when not undone", async () => {
      vi.useFakeTimers();
      const ws = useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      const ids = await seed(ws, ["keep", "remove"]);
      const removed = ids[1];

      useWorkspaceStore.getState().deleteConversation(removed);
      await vi.advanceTimersByTimeAsync(6000);
      await useWorkspaceStore.getState().loadConversations(ws);

      expect(
        (useWorkspaceStore.getState().conversations[ws] ?? []).some(
          (c) => c.conversationId === removed,
        ),
      ).toBe(false);
      expect(useWorkspaceStore.getState().conversationDeleteNotice).toBeNull();
    });

    it("duplicates a conversation and opens the copy", async () => {
      const ws = useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      const [c1] = await seed(ws, ["template chat"]);
      await useWorkspaceStore.getState().renameConversation(c1, "Template");

      await useWorkspaceStore.getState().duplicateConversation(c1);

      const list = useWorkspaceStore.getState().conversations[ws] ?? [];
      const copy = list.find((c) => c.title === "Template (copy)");
      expect(copy).toBeTruthy();
      expect(useWorkspaceStore.getState().activeWorkspace()?.chatThread.conversationId).toBe(
        copy?.conversationId,
      );
    });
  });

  describe("file management (safety paths)", () => {
    it("selectFile opens, loads, and activates a file — the cross-file-link landing", async () => {
      vi.mocked(readFile).mockResolvedValue({ content: "# Hello", lastModifiedMs: 100 });
      const workspaceId = useWorkspaceStore.getState().addWorkspace("/tmp/vault");

      await useWorkspaceStore.getState().selectFile("notes/a.md");

      const workspace = useWorkspaceStore.getState().activeWorkspace();
      expect(workspace?.activeFilePath).toBe("notes/a.md");
      expect(workspace?.openFilePaths).toContain("notes/a.md");
      expect(workspace?.fileContents["notes/a.md"]?.content).toBe("# Hello");
      expect(readFile).toHaveBeenCalledWith(workspaceId, "notes/a.md");
    });

    it("selectFile does not re-read a file whose content is already loaded", async () => {
      vi.mocked(readFile).mockResolvedValue({ content: "x", lastModifiedMs: 1 });
      useWorkspaceStore.getState().addWorkspace("/tmp/vault");

      await useWorkspaceStore.getState().selectFile("a.md");
      await useWorkspaceStore.getState().selectFile("a.md");

      expect(readFile).toHaveBeenCalledTimes(1);
    });

    it("selectFile surfaces a read failure as saveError", async () => {
      vi.mocked(readFile).mockRejectedValue(new Error("disk gone"));
      useWorkspaceStore.getState().addWorkspace("/tmp/vault");

      await useWorkspaceStore.getState().selectFile("missing.md");

      expect(useWorkspaceStore.getState().saveError).toBe("disk gone");
    });

    it("saveActiveFile guards on the buffer's mtime and marks it saved on success", async () => {
      vi.mocked(readFile).mockResolvedValue({ content: "old", lastModifiedMs: 100 });
      vi.mocked(writeFile).mockResolvedValue({ lastModifiedMs: 200 });
      const workspaceId = useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      await useWorkspaceStore.getState().selectFile("a.md");
      useWorkspaceStore.getState().updateActiveContent("new content");

      await useWorkspaceStore.getState().saveActiveFile();

      // The pre-edit mtime is sent as the conflict guard (don't clobber newer disk state).
      expect(writeFile).toHaveBeenCalledWith(
        workspaceId,
        "a.md",
        "new content",
        100,
        expect.anything(),
      );
      const buffer = useWorkspaceStore.getState().activeWorkspace()?.fileContents["a.md"];
      expect(buffer?.dirty).toBe(false);
      expect(buffer?.lastModifiedMs).toBe(200);
      expect(useWorkspaceStore.getState().saveError).toBeNull();
    });

    it("saveActiveFile refuses to clobber a file changed on disk, keeping local edits", async () => {
      vi.mocked(readFile).mockResolvedValue({ content: "old", lastModifiedMs: 100 });
      vi.mocked(writeFile).mockRejectedValue(new FileConflictError(200));
      useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      await useWorkspaceStore.getState().selectFile("a.md");
      useWorkspaceStore.getState().updateActiveContent("local edits");

      await useWorkspaceStore.getState().saveActiveFile();

      const buffer = useWorkspaceStore.getState().activeWorkspace()?.fileContents["a.md"];
      expect(buffer?.conflict).toBe(true);
      expect(buffer?.content).toBe("local edits");
      expect(useWorkspaceStore.getState().saveError).toContain("changed on disk");
    });
  });

  describe("editGuardFor", () => {
    const caps = (overrides: Partial<HarnessCapabilities> = {}): HarnessCapabilities => ({
      credentialRequired: false,
      previewsEdits: false,
      models: [],
      allowsCustomModel: false,
      supportsEffort: false,
      supportsMaxTurns: false,
      supportsLogin: false,
      ...overrides,
    });

    it("never gates a harness that previews its own edits (bob)", () => {
      expect(editGuardFor(caps({ previewsEdits: true }), true, {})).toBe("none");
      expect(editGuardFor(caps({ previewsEdits: true }), false, { reviewEdits: true })).toBe("none");
    });

    it("does not gate a read-only (plan/ask) run", () => {
      expect(editGuardFor(caps(), false, {})).toBe("none");
    });

    it("runs in the real folder by default for a write-capable harness", () => {
      // Decision: CLI harnesses run in your real folder by default so paths /
      // skills / memory line up — undefined reviewEdits → snapshot (undo via a
      // pre-run baseline). See editGuardFor + review-guide.
      expect(editGuardFor(caps(), true, {})).toBe("snapshot");
      expect(editGuardFor(caps(), true, { reviewEdits: false })).toBe("snapshot");
    });

    it("uses the clone sandbox only when the user opts into pre-approval", () => {
      expect(editGuardFor(caps(), true, { reviewEdits: true })).toBe("clone");
    });
  });

  describe("reviewChangeToDraft", () => {
    it("maps clone-diff kinds onto suggestion kinds", () => {
      const base = {
        relativePath: "a.md",
        originalText: null,
        newText: null,
        previewOmitted: false,
        stale: false,
        originalSize: 0,
        newSize: 0,
      };
      expect(reviewChangeToDraft({ ...base, kind: "created" }).kind).toBe("create");
      expect(reviewChangeToDraft({ ...base, kind: "modified" }).kind).toBe("rewrite");
      expect(reviewChangeToDraft({ ...base, kind: "deleted" }).kind).toBe("delete");
    });
  });
});
