import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  harnessCredentialStatus,
  harnessReadiness,
  ollamaInstalled,
  runHarnessStream,
  startOllama,
} from "../lib/ipc/harnessClient";
import { recordLlmThread } from "../lib/ipc/llmContextClient";
import {
  newConversation,
  saveConversation,
  _resetFallbackConversationsForTests,
  type ConversationMessageRecord,
} from "../lib/ipc/conversationsClient";
import { editGuardFor, reviewChangeToDraft, useWorkspaceStore } from "./workspaceStore";
import { useHarnessStore } from "./store/harnessStore";
import { useUiStore } from "./store/uiStore";
import { useToastStore } from "../features/toast/toastStore";
import type { HarnessCapabilities, HarnessInfo, HarnessReadiness } from "../lib/ipc/harnessClient";
import {
  deleteFile,
  FileConflictError,
  readFile,
  scanWorkspace,
  writeFile,
} from "../lib/ipc/filesClient";
import { loadWorkspaceComments } from "../lib/ipc/commentsClient";
import { switchWorkspace as switchWorkspaceIpc } from "../lib/ipc/workspaceClient";

vi.mock("../lib/ipc/filesClient", () => ({
  createFile: vi.fn(),
  createFolder: vi.fn(() => Promise.resolve()),
  deleteFile: vi.fn(),
  FileConflictError: class FileConflictError extends Error {},
  readFile: vi.fn(),
  renameFile: vi.fn(),
  scanWorkspace: vi.fn(),
  scanFolders: vi.fn(() => Promise.resolve([])),
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

vi.mock("../lib/ipc/workspaceClient", () => ({
  // `switchWorkspace` persists the active workspace on the backend (fired and
  // caught in the store); `persistTabs` chains `.catch` on `saveWorkspaceTabs`.
  // Both must resolve rather than return undefined.
  switchWorkspace: vi.fn(() => Promise.resolve()),
  saveWorkspaceTabs: vi.fn(() => Promise.resolve()),
}));

vi.mock("../lib/ipc/harnessClient", () => ({
  cancelHarnessRun: vi.fn(),
  runHarnessStream: vi.fn(),
  subscribeHarnessRun: vi.fn(),
  harnessList: vi.fn(async () => []),
  harnessListModels: vi.fn(async () => []),
  harnessReadiness: vi.fn(async () => null),
  harnessDiscover: vi.fn(async () => []),
  harnessCredentialStatus: vi.fn(async () => ({ configured: false })),
  ollamaInstalled: vi.fn(async () => false),
  startOllama: vi.fn(async () => undefined),
}));

describe("workspace store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetFallbackConversationsForTests();
    useWorkspaceStore.setState({
      activeWorkspaceId: null,
      conversations: {},
      conversationDeleteNotice: null,
      onboarding: {},
      workspaces: [],
    });
    useUiStore.setState({ chatOpen: true, settingsOpen: false });
    useToastStore.setState({ toasts: [] });
    useHarnessStore.setState({
      selectedHarnessReadiness: null,
      harnessCatalog: [],
      harnessModels: {},
      harnessOptions: {},
      allowEdits: true,
      selectedHarnessId: "bob",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("self-heals a transient boot-scan failure by retrying with backoff", async () => {
    vi.useFakeTimers();
    // The vault root is unreadable on the first attempt (iCloud not materialized
    // yet), then readable — the scan must recover on its own, not strand the
    // tree on a false "no notes".
    vi.mocked(scanWorkspace)
      .mockRejectedValueOnce(new Error("could not read workspace root"))
      .mockResolvedValue([{ relativePath: "note.md", lastModifiedMs: 1, sizeBytes: 1 }]);
    vi.mocked(loadWorkspaceComments).mockResolvedValue([]);
    vi.mocked(readFile).mockResolvedValue({ content: "hi", lastModifiedMs: 1 });

    useWorkspaceStore.getState().addWorkspace("/tmp/vault");
    // Attempt 1 fails and schedules a retry — the workspace stays "loading"
    // (recovering), never a false "failed" or empty "ready".
    await useWorkspaceStore.getState().loadActiveWorkspaceFiles();
    expect(useWorkspaceStore.getState().activeWorkspace()?.scanState).toBe("loading");

    await vi.runAllTimersAsync(); // the backoff retry fires and succeeds
    const ws = useWorkspaceStore.getState().activeWorkspace();
    expect(ws?.scanState).toBe("ready");
    expect(ws?.files.map((entry) => entry.relativePath)).toContain("note.md");
  });

  it("gives a persistently failing scan a retryable 'failed', not an endless loop", async () => {
    vi.useFakeTimers();
    vi.mocked(scanWorkspace).mockRejectedValue(new Error("root unreadable"));

    useWorkspaceStore.getState().addWorkspace("/tmp/vault");
    await useWorkspaceStore.getState().loadActiveWorkspaceFiles();
    await vi.runAllTimersAsync();

    expect(useWorkspaceStore.getState().activeWorkspace()?.scanState).toBe("failed");
    // Bounded: the initial attempt plus three backoff retries, then it stops.
    expect(vi.mocked(scanWorkspace).mock.calls.length).toBe(4);
  });

  it("does not spawn a Bob run before its key is configured", async () => {
    // bob's key is the host's concern (the Compose keychain), checked via the
    // generic credential-status command — like any credentialed harness. A
    // missing key blocks the run with a Settings nudge: no LLM thread, no spawn.
    // The loaded catalog is the source of truth for `credentialRequired`.
    vi.mocked(harnessCredentialStatus).mockResolvedValue({ configured: false });
    useHarnessStore.setState({
      harnessCatalog: [
        {
          id: "bob",
          displayName: "Bob",
          description: "",
          requiresInstall: true,
          capabilities: {
            credentialRequired: true,
            previewsEdits: true,
            models: [],
            allowsCustomModel: false,
            supportsEffort: false,
            supportsMaxTurns: false,
            supportsLogin: false,
            supportsCustomInstructions: false,
          },
        },
      ],
    });

    useWorkspaceStore.getState().addWorkspace("/tmp/bob-vault");
    useWorkspaceStore.getState().setChatPrompt("Summarize this note");

    await useWorkspaceStore.getState().sendChatPrompt();

    const workspace = useWorkspaceStore.getState().activeWorkspace();

    expect(harnessCredentialStatus).toHaveBeenCalledWith("bob");
    expect(recordLlmThread).not.toHaveBeenCalled();
    expect(runHarnessStream).not.toHaveBeenCalled();
    expect(workspace?.chatThread.runState).toBe("error");
    expect(workspace?.chatThread.runError).toContain("API key in Settings");
  });

  it("routes a non-bob harness to runHarnessStream without the bob credential preflight", async () => {
    // Codex (and Claude Code) authenticate through their own CLI login,
    // so the run must NOT be gated on bob's API key / install — that
    // gate is what produced "I selected Codex but it told me to connect
    // bob". A missing CLI login surfaces later as that harness's own
    // run error, not a bob-flavoured one.
    vi.mocked(recordLlmThread).mockResolvedValue({ llmThreadId: "llm-1" });

    useHarnessStore.setState({ selectedHarnessId: "codex" });
    useWorkspaceStore.getState().addWorkspace("/tmp/codex-vault");
    useWorkspaceStore.getState().setChatPrompt("Summarize this note");

    await useWorkspaceStore.getState().sendChatPrompt();

    expect(harnessReadiness).not.toHaveBeenCalled();
    expect(runHarnessStream).toHaveBeenCalledWith(
      expect.objectContaining({ harnessId: "codex" }),
    );
  });

  it("gates a non-bob credentialed harness on its own key, not bob's", async () => {
    // A non-bob harness that declares credentialRequired (e.g. OpenRouter) is
    // gated on ITS OWN stored key via the generic keychain check — never bob's
    // API key / install (the bug that told Codex users to "connect bob"). A
    // missing key blocks the run; bob's checks must not fire.
    vi.mocked(harnessCredentialStatus).mockResolvedValue({ configured: false });
    useHarnessStore.setState({
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
            supportsCustomInstructions: false,
          },
        },
      ],
    });
    useWorkspaceStore.getState().addWorkspace("/tmp/acme-vault");
    useWorkspaceStore.getState().setChatPrompt("hello");

    await useWorkspaceStore.getState().sendChatPrompt();

    expect(harnessCredentialStatus).toHaveBeenCalledWith("acme");
    expect(harnessReadiness).not.toHaveBeenCalled();
    expect(runHarnessStream).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeWorkspace()?.chatThread.runState).toBe("error");
  });

  it("runs a non-bob credentialed harness once its key is stored", async () => {
    // With the key present, the generic gate passes and the run proceeds —
    // through the same path as a login-managed CLI, never bob's checks.
    vi.mocked(recordLlmThread).mockResolvedValue({ llmThreadId: "llm-1" });
    vi.mocked(harnessCredentialStatus).mockResolvedValue({ configured: true });
    useHarnessStore.setState({
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
            supportsCustomInstructions: false,
          },
        },
      ],
    });
    useWorkspaceStore.getState().addWorkspace("/tmp/acme-vault");
    useWorkspaceStore.getState().setChatPrompt("hello");

    await useWorkspaceStore.getState().sendChatPrompt();

    expect(harnessCredentialStatus).toHaveBeenCalledWith("acme");
    expect(harnessReadiness).not.toHaveBeenCalled();
    expect(runHarnessStream).toHaveBeenCalledWith(expect.objectContaining({ harnessId: "acme" }));
  });

  it("forwards the selected harness's persisted model + tuning on a run", async () => {
    // The Settings picker stores per-harness model/effort/turn options;
    // a run must carry the *selected* harness's options through to
    // runHarnessStream so the adapter can map them onto CLI flags.
    vi.mocked(recordLlmThread).mockResolvedValue({ llmThreadId: "llm-1" });

    useHarnessStore.setState({
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
    useHarnessStore.setState({ selectedHarnessId: "codex" });
    useWorkspaceStore.getState().addWorkspace("/tmp/codex-vault");

    await useWorkspaceStore.getState().askAboutSelectionStream("What does this do?", {
      range: { start: 0, end: 4 },
      text: "todo",
    });

    expect(harnessCredentialStatus).not.toHaveBeenCalled();
    expect(harnessReadiness).not.toHaveBeenCalled();
    // Ask-about-selection is edit-capable (the assistant can answer *or*
    // edit from the comment), so a write-capable CLI harness runs in "code".
    expect(runHarnessStream).toHaveBeenCalledWith(
      expect.objectContaining({ harnessId: "codex", chatMode: "code" }),
    );
    // The bob "not connected" gate did not fire: no error, no Settings modal.
    const workspace = useWorkspaceStore.getState().activeWorkspace();
    expect(workspace?.chatThread.runState).not.toBe("error");
    expect(workspace?.chatThread.runError).toBeNull();
    expect(useUiStore.getState().settingsOpen).toBe(false);
  });

  it("forwards the selected harness's persisted model + tuning on an ask-about-selection run", () => {
    // Symmetric to the sendChatPrompt tuning test: the "ask about this
    // selection" flow must also carry the *selected* harness's persisted
    // model/effort through to runHarnessStream (edit-capable, so "code"),
    // so the adapter maps them onto the same CLI flags a chat run would.
    vi.mocked(recordLlmThread).mockResolvedValue({ llmThreadId: "llm-1" });

    useHarnessStore.setState({
      selectedHarnessId: "codex",
      harnessOptions: { codex: { model: "gpt-5-codex", effort: "high" } },
    });
    useWorkspaceStore.getState().addWorkspace("/tmp/codex-vault");

    return useWorkspaceStore
      .getState()
      .askAboutSelectionStream("question", { range: { start: 0, end: 4 }, text: "todo" })
      .then(() => {
        expect(runHarnessStream).toHaveBeenCalledWith(
          expect.objectContaining({
            harnessId: "codex",
            chatMode: "code",
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
      useHarnessStore.setState({ selectedHarnessId: "codex" });
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

      expect(useToastStore.getState().toasts.slice(-1)[0]?.message).toBe("disk gone");
    });

    it("ensureActiveBuffer loads the active file's buffer when it is missing (#50)", async () => {
      vi.mocked(readFile).mockResolvedValue({ content: "# Recovered", lastModifiedMs: 7 });
      const workspaceId = useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      // The post-close/delete state: a tab is active but its buffer was never
      // read — the bug stranded the editor on "Loading file…" right here.
      useWorkspaceStore.setState((state) => ({
        workspaces: state.workspaces.map((workspace) =>
          workspace.id === workspaceId
            ? { ...workspace, activeFilePath: "b.md", openFilePaths: ["b.md"], fileContents: {} }
            : workspace,
        ),
      }));

      await useWorkspaceStore.getState().ensureActiveBuffer();

      expect(readFile).toHaveBeenCalledWith(workspaceId, "b.md");
      expect(useWorkspaceStore.getState().activeWorkspace()?.fileContents["b.md"]?.content).toBe(
        "# Recovered",
      );
    });

    it("ensureActiveBuffer does not re-read an already-loaded file", async () => {
      vi.mocked(readFile).mockResolvedValue({ content: "x", lastModifiedMs: 1 });
      useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      await useWorkspaceStore.getState().selectFile("a.md");

      await useWorkspaceStore.getState().ensureActiveBuffer();

      expect(readFile).toHaveBeenCalledTimes(1);
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
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it("saveAllDirtyBuffers writes every dirty buffer and skips clean/conflicted ones (#43)", async () => {
      vi.mocked(writeFile).mockResolvedValue({ lastModifiedMs: 500 });
      const workspaceId = useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      useWorkspaceStore.setState((state) => ({
        workspaces: state.workspaces.map((workspace) =>
          workspace.id === workspaceId
            ? {
                ...workspace,
                activeFilePath: "a.md",
                openFilePaths: ["a.md", "b.md", "c.md", "d.md"],
                fileContents: {
                  // active dirty + background dirty → both written; clean +
                  // conflicted → skipped (a conflicted write would clobber disk).
                  "a.md": { content: "A", lastModifiedMs: 1, dirty: true, conflict: false, pendingChanges: [] },
                  "b.md": { content: "B", lastModifiedMs: 2, dirty: true, conflict: false, pendingChanges: [] },
                  "c.md": { content: "C", lastModifiedMs: 3, dirty: false, conflict: false, pendingChanges: [] },
                  "d.md": { content: "D", lastModifiedMs: 4, dirty: true, conflict: true, pendingChanges: [] },
                },
              }
            : workspace,
        ),
      }));

      await useWorkspaceStore.getState().saveAllDirtyBuffers();

      expect(writeFile).toHaveBeenCalledTimes(2);
      expect(writeFile).toHaveBeenCalledWith(workspaceId, "a.md", "A", 1, []);
      expect(writeFile).toHaveBeenCalledWith(workspaceId, "b.md", "B", 2, []);
      const ws = useWorkspaceStore.getState().activeWorkspace();
      expect(ws?.fileContents["a.md"].dirty).toBe(false);
      expect(ws?.fileContents["b.md"].dirty).toBe(false);
    });

    it("handleFsEvent ignores its own autosave echo (disk byte-identical to the buffer)", async () => {
      vi.mocked(readFile).mockResolvedValueOnce({ content: "# Hello", lastModifiedMs: 100 });
      const workspaceId = useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      await useWorkspaceStore.getState().selectFile("a.md");
      // Watcher fires with a newer mtime (our own save, before the buffer mtime
      // caught up) but the disk content is unchanged → no reload.
      vi.mocked(readFile).mockResolvedValueOnce({ content: "# Hello", lastModifiedMs: 200 });
      await useWorkspaceStore.getState().handleFsEvent(workspaceId, {
        kind: "modified",
        relativePath: "a.md",
        lastModifiedMs: 200,
      });
      const buffer = useWorkspaceStore.getState().activeWorkspace()?.fileContents["a.md"];
      expect(buffer?.content).toBe("# Hello");
      expect(buffer?.lastModifiedMs).toBe(100); // unchanged ⇒ reload skipped
    });

    it("handleFsEvent reloads when the disk content genuinely differs", async () => {
      vi.mocked(readFile).mockResolvedValueOnce({ content: "# Hello", lastModifiedMs: 100 });
      const workspaceId = useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      await useWorkspaceStore.getState().selectFile("a.md");
      vi.mocked(readFile).mockResolvedValueOnce({ content: "# External", lastModifiedMs: 200 });
      await useWorkspaceStore.getState().handleFsEvent(workspaceId, {
        kind: "modified",
        relativePath: "a.md",
        lastModifiedMs: 200,
      });
      const buffer = useWorkspaceStore.getState().activeWorkspace()?.fileContents["a.md"];
      expect(buffer?.content).toBe("# External");
      expect(buffer?.lastModifiedMs).toBe(200);
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
      expect(useToastStore.getState().toasts.slice(-1)[0]?.message).toContain("changed on disk");
    });

    it("deleteActiveFile flushes unsaved edits to disk before deleting, so trash is recoverable", async () => {
      vi.mocked(readFile).mockResolvedValue({ content: "old", lastModifiedMs: 100 });
      vi.mocked(writeFile).mockResolvedValue({ lastModifiedMs: 200 });
      vi.mocked(deleteFile).mockResolvedValue(undefined);
      const workspaceId = useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      await useWorkspaceStore.getState().selectFile("a.md");
      useWorkspaceStore.getState().updateActiveContent("unsaved edits");

      await useWorkspaceStore.getState().deleteActiveFile();

      // The dirty buffer is written first (so the trashed copy holds the edits) ...
      expect(writeFile).toHaveBeenCalledWith(
        workspaceId,
        "a.md",
        "unsaved edits",
        100,
        expect.anything(),
      );
      // ... then the file is deleted, and its tab is gone.
      expect(deleteFile).toHaveBeenCalledWith(workspaceId, "a.md");
      expect(useWorkspaceStore.getState().activeWorkspace()?.openFilePaths).not.toContain("a.md");
    });

    it("deleteActiveFile does not re-write a clean file before deleting", async () => {
      vi.mocked(readFile).mockResolvedValue({ content: "clean", lastModifiedMs: 100 });
      vi.mocked(deleteFile).mockResolvedValue(undefined);
      const workspaceId = useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      await useWorkspaceStore.getState().selectFile("a.md");

      await useWorkspaceStore.getState().deleteActiveFile();

      expect(writeFile).not.toHaveBeenCalled();
      expect(deleteFile).toHaveBeenCalledWith(workspaceId, "a.md");
    });

    it("switching tabs leaves the chat context where the user pinned it (#30)", async () => {
      vi.mocked(readFile).mockResolvedValue({ content: "x", lastModifiedMs: 1 });
      useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      await useWorkspaceStore.getState().selectFile("a.md");
      useWorkspaceStore.getState().addChatFileContext({ label: "a.md", path: "a.md" });

      await useWorkspaceStore.getState().selectFile("b.md");

      const ws = useWorkspaceStore.getState().activeWorkspace();
      expect(ws?.activeFilePath).toBe("b.md");
      expect(ws?.chatThread.contextItems.map((item) => item.path)).toEqual(["a.md"]);
    });

    it("a new chat defaults its context to the active file (#30)", async () => {
      vi.mocked(readFile).mockResolvedValue({ content: "x", lastModifiedMs: 1 });
      useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      await useWorkspaceStore.getState().selectFile("a.md");
      useWorkspaceStore.getState().addChatFileContext({ label: "a.md", path: "a.md" });
      await useWorkspaceStore.getState().selectFile("b.md");

      await useWorkspaceStore.getState().newChat();

      const ctx = useWorkspaceStore.getState().activeWorkspace()?.chatThread.contextItems;
      expect(ctx?.map((item) => item.path)).toEqual(["b.md"]);
    });

    it("deleting a file removes only its context item, keeping the rest (#30)", async () => {
      vi.mocked(readFile).mockResolvedValue({ content: "x", lastModifiedMs: 1 });
      vi.mocked(deleteFile).mockResolvedValue(undefined);
      useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      await useWorkspaceStore.getState().selectFile("a.md");
      await useWorkspaceStore.getState().selectFile("b.md");
      useWorkspaceStore.getState().addChatFileContext({ label: "a.md", path: "a.md" });
      useWorkspaceStore.getState().addChatFileContext({ label: "b.md", path: "b.md" });

      await useWorkspaceStore.getState().deleteActiveFile(); // active is b.md

      const ctx = useWorkspaceStore.getState().activeWorkspace()?.chatThread.contextItems;
      expect(ctx?.map((item) => item.path)).toEqual(["a.md"]);
    });

    it("renaming a context file re-points its context item to the new path (#30)", async () => {
      vi.mocked(readFile).mockResolvedValue({ content: "x", lastModifiedMs: 1 });
      useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      await useWorkspaceStore.getState().selectFile("a.md");
      useWorkspaceStore.getState().addChatFileContext({ label: "a.md", path: "a.md" });

      await useWorkspaceStore.getState().renameActiveFile("c.md");

      const ctx = useWorkspaceStore.getState().activeWorkspace()?.chatThread.contextItems;
      expect(ctx?.map((item) => item.path)).toEqual(["c.md"]);
    });

    it("moving a file = renaming it into another folder, carrying its open tab (#28)", async () => {
      vi.mocked(readFile).mockResolvedValue({ content: "x", lastModifiedMs: 1 });
      useWorkspaceStore.getState().addWorkspace("/tmp/vault");
      await useWorkspaceStore.getState().selectFile("a.md");

      await useWorkspaceStore.getState().renameActiveFile("Archive/a.md");

      const ws = useWorkspaceStore.getState().activeWorkspace();
      expect(ws?.activeFilePath).toBe("Archive/a.md");
      expect(ws?.openFilePaths).toContain("Archive/a.md");
      expect(ws?.openFilePaths).not.toContain("a.md");
    });
  });

  describe("workspace switch persistence", () => {
    it("persists the active workspace on the backend so the next launch restores it", () => {
      const first = useWorkspaceStore.getState().addWorkspace("/tmp/first");
      const second = useWorkspaceStore.getState().addWorkspace("/tmp/second");
      // addWorkspace activates the most-recently-added one.
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(second);

      useWorkspaceStore.getState().switchWorkspace(first);

      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(first);
      // workspace_switch is the only backend command that writes
      // active_workspace_id; mark_opened would only bump last_opened_at and the
      // wrong workspace would be restored on the next boot.
      expect(switchWorkspaceIpc).toHaveBeenCalledWith(first);
    });

    it("ignores a switch to an unknown workspace", () => {
      const only = useWorkspaceStore.getState().addWorkspace("/tmp/only");
      vi.mocked(switchWorkspaceIpc).mockClear();

      useWorkspaceStore.getState().switchWorkspace("does-not-exist");

      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(only);
      expect(switchWorkspaceIpc).not.toHaveBeenCalled();
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
      supportsCustomInstructions: false,
      ...overrides,
    });

    it("never gates a harness that previews its own edits (bob)", () => {
      expect(editGuardFor(caps({ previewsEdits: true }), true, false)).toBe("none");
      expect(editGuardFor(caps({ previewsEdits: true }), false, true)).toBe("none");
    });

    it("does not gate a read-only (plan/ask) run", () => {
      expect(editGuardFor(caps(), false, false)).toBe("none");
    });

    it("runs in the real folder by default for a write-capable harness", () => {
      // Decision: CLI harnesses run in your real folder by default so paths /
      // skills / memory line up — reviewEdits off → snapshot (undo via a
      // pre-run baseline). See editGuardFor + review-guide.
      expect(editGuardFor(caps(), true, false)).toBe("snapshot");
    });

    it("uses the clone sandbox only when the user opts into pre-approval", () => {
      expect(editGuardFor(caps(), true, true)).toBe("clone");
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

  describe("resolveDefaultHarness (first-run default)", () => {
    const agent = (id: string): HarnessInfo => ({
      id,
      displayName: id,
      description: "",
      requiresInstall: false,
      capabilities: {
        credentialRequired: false,
        previewsEdits: false,
        models: [],
        allowsCustomModel: false,
        supportsEffort: false,
        supportsMaxTurns: false,
        supportsLogin: false,
        supportsCustomInstructions: false,
      },
    });
    const readiness = (harnessId: string, ready: boolean): HarnessReadiness => ({
      harnessId,
      ready,
      installed: ready,
      version: null,
      authConfigured: ready,
      error: null,
      details: null,
    });

    it("picks the first ready agent in catalog (Ollama-first) order", async () => {
      useHarnessStore.setState({
        selectedHarnessId: "",
        harnessCatalog: [agent("ollama"), agent("claude"), agent("codex")],
      });
      // Ollama not running; Claude signed in — Claude wins as the first ready.
      vi.mocked(harnessReadiness).mockImplementation(async (id) => readiness(id, id === "claude"));
      await useHarnessStore.getState().resolveDefaultHarness();
      expect(useHarnessStore.getState().selectedHarnessId).toBe("claude");
    });

    it("leaves the agent unset when none are ready and Ollama isn't installed", async () => {
      useHarnessStore.setState({
        selectedHarnessId: "",
        harnessCatalog: [agent("ollama"), agent("claude")],
      });
      vi.mocked(harnessReadiness).mockImplementation(async (id) => readiness(id, false));
      vi.mocked(ollamaInstalled).mockResolvedValue(false);
      await useHarnessStore.getState().resolveDefaultHarness();
      expect(useHarnessStore.getState().selectedHarnessId).toBe("");
      expect(startOllama).not.toHaveBeenCalled();
    });

    it("defaults to Ollama and starts it when nothing is ready but Ollama is installed", async () => {
      vi.useFakeTimers();
      try {
        useHarnessStore.setState({
          selectedHarnessId: "",
          harnessCatalog: [agent("ollama"), agent("claude")],
        });
        // Nothing reachable, but the Ollama app is on disk (its server is stopped).
        vi.mocked(harnessReadiness).mockImplementation(async (id) => readiness(id, false));
        vi.mocked(ollamaInstalled).mockResolvedValue(true);
        const done = useHarnessStore.getState().resolveDefaultHarness();
        await vi.runAllTimersAsync(); // flush the post-launch boot wait
        await done;
        expect(useHarnessStore.getState().selectedHarnessId).toBe("ollama");
        expect(startOllama).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("respects an explicit choice and never probes", async () => {
      useHarnessStore.setState({
        selectedHarnessId: "codex",
        harnessCatalog: [agent("ollama"), agent("claude"), agent("codex")],
      });
      await useHarnessStore.getState().resolveDefaultHarness();
      expect(useHarnessStore.getState().selectedHarnessId).toBe("codex");
      expect(harnessReadiness).not.toHaveBeenCalled();
    });

    it("skips an agent whose probe fails (offline) and keeps going", async () => {
      useHarnessStore.setState({
        selectedHarnessId: "",
        harnessCatalog: [agent("ollama"), agent("openrouter")],
      });
      // Ollama unreachable (offline / not running) throws; OpenRouter's keychain
      // probe is ready. A thrown probe must not abort the cascade.
      vi.mocked(harnessReadiness).mockImplementation(async (id) => {
        if (id === "ollama") throw new Error("connection refused");
        return readiness(id, true);
      });
      await useHarnessStore.getState().resolveDefaultHarness();
      expect(useHarnessStore.getState().selectedHarnessId).toBe("openrouter");
    });

    it("refreshHarnessStatuses probes uncached agents and caches each ready state", async () => {
      useHarnessStore.setState({
        harnessCatalog: [agent("ollama"), agent("claude")],
        harnessStatusById: {},
        harnessProbing: {},
      });
      vi.mocked(harnessReadiness).mockImplementation(async (id) => readiness(id, id === "ollama"));
      await useHarnessStore.getState().refreshHarnessStatuses();
      const cache = useHarnessStore.getState().harnessStatusById;
      expect(cache.ollama?.ready).toBe(true);
      expect(cache.claude?.ready).toBe(false);
      expect(useHarnessStore.getState().harnessProbing.ollama).toBe(false);
    });

    it("refreshHarnessStatuses skips a fresh cache entry instead of re-probing", async () => {
      useHarnessStore.setState({
        harnessCatalog: [agent("ollama")],
        harnessStatusById: { ollama: { ready: true, at: Date.now() } },
        harnessProbing: {},
      });
      vi.mocked(harnessReadiness).mockClear();
      await useHarnessStore.getState().refreshHarnessStatuses();
      expect(harnessReadiness).not.toHaveBeenCalled();
    });
  });
});
