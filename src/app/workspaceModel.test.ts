import { describe, expect, it } from "vitest";
import {
  acceptWorkspaceSuggestion,
  appendAssistantText,
  appendAssistantSuggestions,
  appendAssistantThinking,
  endAssistantToolCall,
  startAssistantToolCall,
  assistantMessageContentForRun,
  appendUserChatMessage,
  applyFileBuffer,
  applyFsEvent,
  applyScanResult,
  closeWorkspaceFileTab,
  bobRuntimeReadiness,
  createLlmContextSnapshots,
  createWorkspaceFromPath,
  createWorkspaceFromRecord,
  dismissBufferConflict,
  finalizeBobRun,
  hydrateWorkspaceRecords,
  isSetupComplete,
  markBobRunStreaming,
  markBufferConflict,
  markBufferDirty,
  markBufferSaved,
  openWorkspaceFile,
  prepareWorkspaceSuggestionDrafts,
  rejectWorkspaceSuggestion,
  setAssistantActivity,
  setCommentChatContext,
  setCurrentTabContext,
  startBobRun,
  type BobWorkspace,
  type WorkspaceFileEntry,
} from "./workspaceModel";

function makeEntry(relativePath: string, lastModifiedMs = 1_000): WorkspaceFileEntry {
  return { relativePath, lastModifiedMs, sizeBytes: 16 };
}

function workspaceWithFiles(path: string, files: string[]): BobWorkspace {
  return applyScanResult(
    createWorkspaceFromPath(path),
    files.map((file) => makeEntry(file)),
  );
}

describe("workspace model", () => {
  it("blocks first-run entry until Bob auth and one workspace are configured", () => {
    expect(isSetupComplete({ configured: false }, [])).toBe(false);
    expect(isSetupComplete({ configured: true }, [])).toBe(false);
    expect(isSetupComplete({ configured: false }, [createWorkspaceFromPath("/tmp/project")])).toBe(
      false,
    );
    expect(isSetupComplete({ configured: true }, [createWorkspaceFromPath("/tmp/project")])).toBe(
      true,
    );
  });

  it("reports Bob runtime readiness without treating browser preview as real Bob", () => {
    expect(bobRuntimeReadiness({ configured: false }, null)).toEqual({
      message: "Connect your Bob API key.",
      ready: false,
    });
    expect(
      bobRuntimeReadiness(
        { configured: true },
        {
          errorMessage: "Bob credentials and CLI checks require the Tauri desktop runtime.",
          installed: false,
          requiresDesktopRuntime: true,
        },
      ),
    ).toEqual({
      message: "Open the desktop app to run Bob.",
      ready: false,
    });
    expect(
      bobRuntimeReadiness(
        { configured: true },
        {
          installed: true,
          path: "/usr/local/bin/bob",
          version: "1.0.4",
        },
      ),
    ).toEqual({ message: null, ready: true });
  });

  it("starts a workspace with no files and no active tab", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");

    expect(workspace.activeFilePath).toBe("");
    expect(workspace.files).toHaveLength(0);
    expect(workspace.openFilePaths).toHaveLength(0);
    expect(workspace.chatThread.contextItems).toHaveLength(0);
    expect(workspace.scanState).toBe("idle");
  });

  it("keeps current-tab chat context scoped to each workspace", () => {
    const first = workspaceWithFiles("/tmp/alpha", ["a.md", "b.md"]);
    const second = workspaceWithFiles("/tmp/beta", ["c.md", "d.md"]);

    const firstChat = setCurrentTabContext(first.chatThread, first.id, first.files[0].relativePath);
    const secondChat = setCurrentTabContext(
      second.chatThread,
      second.id,
      second.files[1].relativePath,
    );

    expect(firstChat.contextItems).toHaveLength(1);
    expect(secondChat.contextItems).toHaveLength(1);
    expect(firstChat.contextItems[0].workspaceId).toBe(first.id);
    expect(secondChat.contextItems[0].workspaceId).toBe(second.id);
    expect(firstChat.contextItems[0].id).not.toBe(secondChat.contextItems[0].id);
  });

  it("opens multiple editor tabs and keeps Bob context on the active tab", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md", "b.md", "c.md"]);
    const first = workspace.files[0].relativePath;
    const second = workspace.files[1].relativePath;
    const firstOpen = openWorkspaceFile(workspace, first);
    const secondOpen = openWorkspaceFile(firstOpen, second);

    expect(secondOpen.openFilePaths).toEqual([first, second]);
    expect(secondOpen.activeFilePath).toBe(second);
    expect(secondOpen.chatThread.contextItems.map((item) => item.path)).toEqual([second]);
  });

  it("builds auditable LLM context snapshots from file and comment context", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md"]);
    const fileContext = setCurrentTabContext(workspace.chatThread, workspace.id, "a.md");
    const commentContext = setCommentChatContext(fileContext, workspace.id, {
      anchor: {
        prefix: "before",
        range: { start: 2, end: 8 },
        resolution: "resolved",
        selectedText: "select",
        suffix: "after",
      },
      body: "Help",
      createdAt: 1,
      filePath: "a.md",
      id: "comment-1",
      status: "open",
      updatedAt: 1,
    });

    expect(createLlmContextSnapshots(commentContext.contextItems)).toEqual([
      {
        filePath: "a.md",
        kind: "file",
      },
      {
        anchor: {
          prefix: "before",
          range: { start: 2, end: 8 },
          resolution: "resolved",
          selectedText: "select",
          suffix: "after",
        },
        filePath: "a.md",
        kind: "comment",
        selectedTextSnapshot: "select",
        sourceCommentId: "comment-1",
        sourceRange: { start: 2, end: 8 },
        surroundingContextSnapshot: "beforeselectafter",
      },
    ]);
  });

  it("closes the active tab, moves Bob context, and drops its buffer", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md", "b.md", "c.md"]);
    const [a, b, c] = workspace.files.map((entry) => entry.relativePath);
    const withTabs = [a, b, c].reduce(
      (current, filePath) =>
        applyFileBuffer(openWorkspaceFile(current, filePath), filePath, {
          content: `# ${filePath}`,
          lastModifiedMs: 2_000,
        }),
      workspace,
    );

    expect(Object.keys(withTabs.fileContents)).toHaveLength(3);

    const closed = closeWorkspaceFileTab(withTabs, c);
    expect(closed.openFilePaths).toEqual([a, b]);
    expect(closed.activeFilePath).toBe(b);
    expect(closed.chatThread.contextItems.map((item) => item.path)).toEqual([b]);
    expect(Object.keys(closed.fileContents).sort()).toEqual([a, b]);
  });

  it("stores user chat messages without fabricating a Bob reply", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const chatThread = appendUserChatMessage(
      workspace.chatThread,
      "Summarize this note",
      "BOBSHELL_API_KEY=<configured> bob --auth-method api-key",
    );

    expect(chatThread.prompt).toBe("");
    expect(chatThread.preparedCommand).toContain("--auth-method api-key");
    expect(chatThread.messages).toEqual([
      {
        activity: null,
        content: "Summarize this note",
        id: "message-1",
        role: "user",
      },
    ]);
  });

  it("links persisted LLM thread ids to the auditable chat messages", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const llmThreadId = "llm-thread-1";
    const withUser = appendUserChatMessage(workspace.chatThread, "Audit this context", null, llmThreadId);
    const started = startBobRun(withUser, runId, llmThreadId);
    const streaming = markBobRunStreaming(started, runId);

    expect(streaming.messages[0]).toMatchObject({
      content: "Audit this context",
      llmThreadId,
      role: "user",
    });
    expect(streaming.messages[1]).toMatchObject({
      llmThreadId,
      role: "assistant",
      runId,
    });
  });

  it("applyScanResult preserves open tabs and buffers that still exist on disk", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md", "b.md"]);
    const opened = applyFileBuffer(
      openWorkspaceFile(openWorkspaceFile(workspace, "a.md"), "b.md"),
      "a.md",
      { content: "# A", lastModifiedMs: 1_500 },
    );

    const rescanned = applyScanResult(opened, [makeEntry("a.md", 2_000), makeEntry("c.md")]);

    expect(rescanned.files.map((entry) => entry.relativePath)).toEqual(["a.md", "c.md"]);
    expect(rescanned.openFilePaths).toEqual(["a.md"]);
    expect(rescanned.activeFilePath).toBe("a.md");
    expect(rescanned.fileContents["a.md"].content).toBe("# A");
    expect(rescanned.fileContents).not.toHaveProperty("b.md");
  });

  it("applyFsEvent on a dirty buffer marks it as conflicted", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md"]);
    const opened = applyFileBuffer(openWorkspaceFile(workspace, "a.md"), "a.md", {
      content: "# A",
      lastModifiedMs: 1_000,
    });
    const dirty = markBufferDirty(opened, "a.md", "# A edited");

    const { workspace: next, effect } = applyFsEvent(dirty, {
      kind: "modified",
      lastModifiedMs: 5_000,
      relativePath: "a.md",
    });

    expect(effect.type).toBe("noop");
    expect(next.fileContents["a.md"].conflict).toBe(true);
    expect(next.fileContents["a.md"].dirty).toBe(true);
    expect(next.fileContents["a.md"].content).toBe("# A edited");
  });

  it("applyFsEvent on a clean buffer requests a reload", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md"]);
    const opened = applyFileBuffer(openWorkspaceFile(workspace, "a.md"), "a.md", {
      content: "# A",
      lastModifiedMs: 1_000,
    });

    const { effect } = applyFsEvent(opened, {
      kind: "modified",
      lastModifiedMs: 5_000,
      relativePath: "a.md",
    });

    expect(effect).toEqual({ type: "reloadFile", relativePath: "a.md" });
  });

  it("applyFsEvent ignores echoes that match the current buffer mtime", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md"]);
    const opened = applyFileBuffer(openWorkspaceFile(workspace, "a.md"), "a.md", {
      content: "# A",
      lastModifiedMs: 5_000,
    });

    const { effect } = applyFsEvent(opened, {
      kind: "modified",
      lastModifiedMs: 5_000,
      relativePath: "a.md",
    });

    expect(effect.type).toBe("noop");
  });

  it("applyFsEvent on create/remove triggers a rescan", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md"]);

    expect(
      applyFsEvent(workspace, { kind: "created", lastModifiedMs: 5, relativePath: "b.md" }).effect,
    ).toEqual({ type: "rescan" });
    expect(
      applyFsEvent(workspace, { kind: "removed", lastModifiedMs: null, relativePath: "a.md" })
        .effect,
    ).toEqual({ type: "rescan" });
  });

  it("markBufferSaved clears dirty and bumps lastModifiedMs", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md"]);
    const opened = applyFileBuffer(openWorkspaceFile(workspace, "a.md"), "a.md", {
      content: "# A",
      lastModifiedMs: 1_000,
    });
    const dirty = markBufferDirty(opened, "a.md", "# A edited");

    const saved = markBufferSaved(dirty, "a.md", 7_777);

    expect(saved.fileContents["a.md"].dirty).toBe(false);
    expect(saved.fileContents["a.md"].lastModifiedMs).toBe(7_777);
    expect(saved.files.find((entry) => entry.relativePath === "a.md")?.lastModifiedMs).toBe(7_777);
    expect(saved.lastSavedAt).toBeInstanceOf(Date);
  });

  it("tracks pending byte-range changes until save", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md"]);
    const opened = applyFileBuffer(openWorkspaceFile(workspace, "a.md"), "a.md", {
      content: "alpha",
      lastModifiedMs: 1_000,
    });

    const first = markBufferDirty(opened, "a.md", "alpha!", [
      { range: { start: 5, end: 5 }, text: "!" },
    ]);
    const second = markBufferDirty(first, "a.md", "ALPHA!", [
      { range: { start: 0, end: 5 }, text: "ALPHA" },
    ]);

    expect(second.fileContents["a.md"].pendingChanges).toEqual([
      { range: { start: 5, end: 5 }, text: "!" },
      { range: { start: 0, end: 5 }, text: "ALPHA" },
    ]);

    const saved = markBufferSaved(second, "a.md", 2_000);
    expect(saved.fileContents["a.md"].pendingChanges).toEqual([]);
  });

  it("createWorkspaceFromRecord restores persisted tabs", () => {
    const workspace = createWorkspaceFromRecord({
      id: "workspace-restored",
      name: "restored",
      path: "/tmp/restored",
      tabs: {
        activeFilePath: "notes/active.md",
        openFilePaths: ["notes/active.md", "runs/log.md"],
      },
    });

    expect(workspace.activeFilePath).toBe("notes/active.md");
    expect(workspace.openFilePaths).toEqual(["notes/active.md", "runs/log.md"]);
    expect(workspace.chatThread.contextItems.map((item) => item.path)).toEqual([
      "notes/active.md",
    ]);
  });

  it("hydrateWorkspaceRecords keeps existing in-memory state when the id matches", () => {
    const existing = createWorkspaceFromRecord({
      id: "workspace-x",
      name: "x",
      path: "/tmp/x",
      tabs: { activeFilePath: "notes/a.md", openFilePaths: ["notes/a.md"] },
    });
    const populated = applyScanResult(existing, [
      { lastModifiedMs: 1, relativePath: "notes/a.md", sizeBytes: 4 },
    ]);

    const merged = hydrateWorkspaceRecords(
      [populated],
      [
        {
          id: "workspace-x",
          name: "x",
          path: "/tmp/x",
          tabs: { activeFilePath: "notes/a.md", openFilePaths: ["notes/a.md"] },
        },
      ],
    );

    expect(merged[0]).toBe(populated);
  });

  it("startBobRun → markBobRunStreaming → appendAssistantText builds a streaming reply", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const t1 = appendUserChatMessage(workspace.chatThread, "Hi Bob", null);
    const t2 = startBobRun(t1, runId, "llm-thread-1");
    expect(t2.runState).toBe("starting");
    expect(t2.activeRunId).toBe(runId);
    expect(t2.activeLlmThreadId).toBe("llm-thread-1");

    const t3 = markBobRunStreaming(t2, runId);
    expect(t3.runState).toBe("streaming");
    expect(t3.messages[t3.messages.length - 1]?.role).toBe("assistant");
    expect(t3.messages[t3.messages.length - 1]?.streaming).toBe(true);

    const t4 = appendAssistantText(appendAssistantText(t3, runId, "Hello "), runId, "world");
    expect(t4.messages[t4.messages.length - 1]?.content).toBe("Hello world");
    expect(assistantMessageContentForRun(t4, runId)).toBe("Hello world");
  });

  it("finalizeBobRun marks success and clears the streaming flag", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const streaming = appendAssistantText(
      markBobRunStreaming(startBobRun(workspace.chatThread, runId), runId),
      runId,
      "done",
    );
    const finalized = finalizeBobRun(streaming, runId, { exitCode: 0 });
    expect(finalized.runState).toBe("idle");
    expect(finalized.activeRunId).toBeNull();
    expect(finalized.activeLlmThreadId).toBeNull();
    expect(finalized.messages[finalized.messages.length - 1]?.streaming).toBe(false);
    expect(finalized.runError).toBeNull();
  });

  it("finalizeBobRun surfaces a runError on non-zero exit", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const streaming = markBobRunStreaming(startBobRun(workspace.chatThread, runId), runId);

    const failed = finalizeBobRun(streaming, runId, { exitCode: 2 });
    expect(failed.runState).toBe("error");
    expect(failed.runError).toContain("2");
  });

  it("setAssistantActivity attaches a status line to the latest assistant message", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const streaming = markBobRunStreaming(startBobRun(workspace.chatThread, runId), runId);

    const annotated = setAssistantActivity(streaming, runId, "Reading notes/a.md");
    expect(annotated.messages[annotated.messages.length - 1]?.activity).toBe("Reading notes/a.md");
  });

  it("turns Bob suggested edits into pending message suggestions", () => {
    const workspace = applyFileBuffer(
      openWorkspaceFile(workspaceWithFiles("/tmp/alpha", ["a.md"]), "a.md"),
      "a.md",
      { content: "# Old title\n", lastModifiedMs: 1_000 },
    );
    const runId = "run-1";
    const started = startBobRun(
      appendUserChatMessage(workspace.chatThread, "Improve the title", null),
      runId,
    );
    const preparation = prepareWorkspaceSuggestionDrafts(workspace, [
      {
        filePath: "a.md",
        range: { start: 2, end: 11 },
        replacement: "Launch plan",
        title: "Rename heading",
      },
    ]);
    const withSuggestion = appendAssistantSuggestions(started, runId, preparation.drafts, 123);

    expect(preparation.rejectedCount).toBe(0);
    expect(withSuggestion.messages[1].suggestions).toEqual([
      {
        createdAt: 123,
        filePath: "a.md",
        id: "message-2-suggestion-1",
        originalText: "Old title",
        range: { start: 2, end: 11 },
        replacement: "Launch plan",
        status: "pending",
        statusMessage: null,
        title: "Rename heading",
        updatedAt: 123,
      },
    ]);
  });

  it("acceptWorkspaceSuggestion applies the patch as a dirty document transaction", () => {
    const base = applyFileBuffer(
      openWorkspaceFile(workspaceWithFiles("/tmp/alpha", ["a.md"]), "a.md"),
      "a.md",
      { content: "# Old title\n", lastModifiedMs: 1_000 },
    );
    const runId = "run-1";
    const started = startBobRun(appendUserChatMessage(base.chatThread, "Improve title", null), runId);
    const { drafts } = prepareWorkspaceSuggestionDrafts(base, [
      {
        filePath: "a.md",
        range: { start: 2, end: 11 },
        replacement: "Launch plan",
        title: "Rename heading",
      },
    ]);
    const withSuggestion = {
      ...base,
      chatThread: appendAssistantSuggestions(started, runId, drafts, 123),
    };

    const accepted = acceptWorkspaceSuggestion(withSuggestion, "message-2-suggestion-1", 456);

    expect(accepted.fileContents["a.md"].content).toBe("# Launch plan\n");
    expect(accepted.fileContents["a.md"].dirty).toBe(true);
    expect(accepted.fileContents["a.md"].pendingChanges).toEqual([
      { range: { start: 2, end: 11 }, text: "Launch plan" },
    ]);
    expect(accepted.chatThread.messages[1].suggestions?.[0]).toMatchObject({
      status: "accepted",
      updatedAt: 456,
    });
  });

  it("acceptWorkspaceSuggestion marks stale suggestions without mutating changed source", () => {
    const base = applyFileBuffer(
      openWorkspaceFile(workspaceWithFiles("/tmp/alpha", ["a.md"]), "a.md"),
      "a.md",
      { content: "# Old title\n", lastModifiedMs: 1_000 },
    );
    const runId = "run-1";
    const started = startBobRun(appendUserChatMessage(base.chatThread, "Improve title", null), runId);
    const { drafts } = prepareWorkspaceSuggestionDrafts(base, [
      {
        filePath: "a.md",
        range: { start: 2, end: 11 },
        replacement: "Launch plan",
        title: "Rename heading",
      },
    ]);
    const withSuggestion = {
      ...base,
      chatThread: appendAssistantSuggestions(started, runId, drafts, 123),
    };
    const changed = markBufferDirty(withSuggestion, "a.md", "# Changed\n");

    const accepted = acceptWorkspaceSuggestion(changed, "message-2-suggestion-1", 456);

    expect(accepted.fileContents["a.md"].content).toBe("# Changed\n");
    expect(accepted.chatThread.messages[1].suggestions?.[0]).toMatchObject({
      status: "stale",
      statusMessage: "Source changed since Bob suggested this edit.",
    });
  });

  it("rejectWorkspaceSuggestion records rejection without mutating the document", () => {
    const base = applyFileBuffer(
      openWorkspaceFile(workspaceWithFiles("/tmp/alpha", ["a.md"]), "a.md"),
      "a.md",
      { content: "# Old title\n", lastModifiedMs: 1_000 },
    );
    const runId = "run-1";
    const started = startBobRun(appendUserChatMessage(base.chatThread, "Improve title", null), runId);
    const { drafts } = prepareWorkspaceSuggestionDrafts(base, [
      {
        filePath: "a.md",
        range: { start: 2, end: 11 },
        replacement: "Launch plan",
        title: "Rename heading",
      },
    ]);
    const withSuggestion = {
      ...base,
      chatThread: appendAssistantSuggestions(started, runId, drafts, 123),
    };

    const rejected = rejectWorkspaceSuggestion(withSuggestion, "message-2-suggestion-1", 456);

    expect(rejected.fileContents["a.md"].content).toBe("# Old title\n");
    expect(rejected.chatThread.messages[1].suggestions?.[0]).toMatchObject({
      status: "rejected",
      updatedAt: 456,
    });
  });

  it("dismissBufferConflict clears the conflict flag", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md"]);
    const opened = applyFileBuffer(openWorkspaceFile(workspace, "a.md"), "a.md", {
      content: "# A",
      lastModifiedMs: 1_000,
    });
    const conflicted = markBufferConflict(opened, "a.md");
    expect(conflicted.fileContents["a.md"].conflict).toBe(true);

    const dismissed = dismissBufferConflict(conflicted, "a.md");
    expect(dismissed.fileContents["a.md"].conflict).toBe(false);
  });

  // Gap 1 (fallback b): the thinking / toolStart / toolEnd model helpers are
  // exercised directly. The store-driven path (capturing subscribeHarnessRun's
  // callback) is async and entangled with the rAF-batched run pipeline; these
  // pure reducers give a deterministic, non-flaky assertion of the same
  // behavior handleHarnessRunEvent dispatches to.
  describe("assistant streaming events (thinking + tool calls)", () => {
    const streamingThread = () => {
      const base = createWorkspaceFromPath("/tmp/test-vault").chatThread;
      const withUser = appendUserChatMessage(base, "Refactor this", null);
      const started = startBobRun(withUser, "run-1", null);
      return markBobRunStreaming(started, "run-1");
    };

    it("accumulates model reasoning onto the active assistant message", () => {
      const streaming = streamingThread();
      const afterFirst = appendAssistantThinking(streaming, "run-1", "Let me ");
      const afterSecond = appendAssistantThinking(afterFirst, "run-1", "think...");

      const assistant = afterSecond.messages[afterSecond.messages.length - 1];
      expect(assistant.role).toBe("assistant");
      expect(assistant.thinking).toBe("Let me think...");
      expect(assistant.content).toBe("");
    });

    it("ignores reasoning + tool events for an inactive run", () => {
      const streaming = streamingThread();
      const thinking = appendAssistantThinking(streaming, "run-x", "nope");
      const toolStart = startAssistantToolCall(thinking, "run-x", "t1", "Edit");
      const toolEnd = endAssistantToolCall(toolStart, "run-x", "t1", true);

      const assistant = toolEnd.messages[toolEnd.messages.length - 1];
      expect(assistant.thinking).toBeUndefined();
      expect(assistant.tools).toBeUndefined();
    });

    it("opens a tool card as running and flips it to done on success", () => {
      const streaming = streamingThread();
      const opened = startAssistantToolCall(streaming, "run-1", "t1", "Edit");
      const openedMessage = opened.messages[opened.messages.length - 1];
      expect(openedMessage.tools).toEqual([{ id: "t1", name: "Edit", status: "running" }]);

      const closed = endAssistantToolCall(opened, "run-1", "t1", true);
      const closedMessage = closed.messages[closed.messages.length - 1];
      expect(closedMessage.tools).toEqual([{ id: "t1", name: "Edit", status: "done" }]);
    });

    it("flips a tool card to error when the tool fails", () => {
      const streaming = streamingThread();
      const opened = startAssistantToolCall(streaming, "run-1", "t1", "Bash");
      const closed = endAssistantToolCall(opened, "run-1", "t1", false);

      const message = closed.messages[closed.messages.length - 1];
      expect(message.tools).toEqual([{ id: "t1", name: "Bash", status: "error" }]);
    });

    it("dedupes a repeated toolStart by id and tracks multiple tools", () => {
      const streaming = streamingThread();
      const first = startAssistantToolCall(streaming, "run-1", "t1", "Edit");
      const duplicate = startAssistantToolCall(first, "run-1", "t1", "Edit");
      const second = startAssistantToolCall(duplicate, "run-1", "t2", "Read");

      const message = second.messages[second.messages.length - 1];
      expect(message.tools).toEqual([
        { id: "t1", name: "Edit", status: "running" },
        { id: "t2", name: "Read", status: "running" },
      ]);
    });
  });
});
