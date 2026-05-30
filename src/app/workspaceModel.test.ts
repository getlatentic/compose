import { describe, expect, it } from "vitest";
import {
  acceptWorkspaceSuggestion,
  appendAssistantText,
  appendAssistantNotice,
  appendAssistantSuggestions,
  assistantMessageContentForRun,
  appendUserChatMessage,
  appendAssistantThinking,
  endAssistantToolCall,
  setAssistantSession,
  setAssistantStats,
  startAssistantToolCall,
  createPromptWithContext,
  hydrateChatThread,
  resetChatThread,
  serializeChatMessages,
  CONVERSATION_REPLAY_LIMIT,
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

  it("concatenates narration deltas into one ordered trace entry, never the answer", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const streaming = markBobRunStreaming(startBobRun(workspace.chatThread, runId), runId);

    // Two deltas of the same narration message concatenate into one entry.
    const t1 = appendAssistantNotice(streaming, runId, "I'll read ");
    const t2 = appendAssistantNotice(t1, runId, "the file.");
    const msg = t2.messages[t2.messages.length - 1];
    expect(msg?.trace).toEqual([{ kind: "notice", text: "I'll read the file." }]);
    // Narration is never the answer.
    expect(msg?.content).toBe("");

    // The answer (attempt_completion → Text) is the only thing in content.
    const answered = appendAssistantText(t2, runId, "The file is about relocation.");
    expect(answered.messages[answered.messages.length - 1]?.content).toBe(
      "The file is about relocation.",
    );
  });

  it("does not start a trace entry for a whitespace-only notice", () => {
    // bob emits a "\n\n" message after a tool; it must not become a blank
    // trace step (which would blank the live status line).
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    let thread = markBobRunStreaming(startBobRun(workspace.chatThread, runId), runId);
    thread = appendAssistantNotice(thread, runId, "Reading the notes.");
    thread = startAssistantToolCall(thread, runId, "t1", "read_file", "{}");
    thread = endAssistantToolCall(thread, runId, "t1", true, "ok");
    thread = appendAssistantNotice(thread, runId, "\n\n"); // the bob filler
    const trace = thread.messages[thread.messages.length - 1]?.trace ?? [];
    // No blank notice entry was added after the tool.
    expect(trace.filter((e) => e.kind === "notice")).toEqual([
      { kind: "notice", text: "Reading the notes." },
    ]);
    expect(trace[trace.length - 1]?.kind).toBe("tool");
  });

  it("builds an ordered trace: thinking → notice → tool, with tool input/output", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    let thread = markBobRunStreaming(startBobRun(workspace.chatThread, runId), runId);
    thread = appendAssistantThinking(thread, runId, "Let me ");
    thread = appendAssistantThinking(thread, runId, "look.");
    thread = appendAssistantNotice(thread, runId, "Reading the notes.");
    thread = startAssistantToolCall(thread, runId, "t1", "read_file", '{"path":"a.md"}');
    thread = endAssistantToolCall(thread, runId, "t1", true, "ok: 10 lines");

    const trace = thread.messages[thread.messages.length - 1]?.trace;
    // Interleaved in arrival order; consecutive thinking deltas merged.
    expect(trace).toEqual([
      { kind: "thinking", text: "Let me look." },
      { kind: "notice", text: "Reading the notes." },
      {
        kind: "tool",
        tool: {
          id: "t1",
          name: "read_file",
          status: "done",
          input: '{"path":"a.md"}',
          output: "ok: 10 lines",
        },
      },
    ]);

    // The trace survives finalize.
    const finalized = finalizeBobRun(thread, runId, { exitCode: 0 });
    expect(finalized.messages[finalized.messages.length - 1]?.trace).toHaveLength(3);
  });

  it("records session id and usage stats on the assistant message", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const streaming = markBobRunStreaming(startBobRun(workspace.chatThread, runId), runId);
    const withSession = setAssistantSession(streaming, runId, "session-abc");
    const withStats = setAssistantStats(withSession, runId, {
      totalTokens: 1234,
      toolCalls: 3,
      coins: 0.06,
    });
    const msg = withStats.messages[withStats.messages.length - 1];
    expect(msg?.sessionId).toBe("session-abc");
    expect(msg?.stats).toEqual({ totalTokens: 1234, toolCalls: 3, coins: 0.06 });
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

  it("serialize → hydrate round-trips content, trace, and stats", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    let thread = markBobRunStreaming(
      startBobRun(appendUserChatMessage(workspace.chatThread, "what is this about?", null), runId),
      runId,
    );
    thread = appendAssistantThinking(thread, runId, "Let me look.");
    thread = startAssistantToolCall(thread, runId, "t1", "read_file", '{"path":"a.md"}');
    thread = endAssistantToolCall(thread, runId, "t1", true, "ok: 10 lines");
    thread = appendAssistantText(thread, runId, "It is a relocation plan.");
    thread = setAssistantStats(thread, runId, { totalTokens: 21956, coins: 0.05 });
    thread = finalizeBobRun(thread, runId, { exitCode: 0 });
    thread = { ...thread, conversationId: "conv-1" };

    const records = serializeChatMessages(thread);
    // Only settled turns (with content): the user + the answer.
    expect(records.map((r) => r.role)).toEqual(["user", "assistant"]);

    const snapshot = {
      conversationId: "conv-1",
      title: null,
      harnessId: "bob",
      messages: records,
      createdAt: 0,
      updatedAt: 1,
    };
    const fresh = createWorkspaceFromPath("/tmp/alpha").chatThread;
    const restored = hydrateChatThread(fresh, snapshot);

    expect(restored.conversationId).toBe("conv-1");
    expect(restored.messages).toHaveLength(2);
    const answer = restored.messages[1];
    expect(answer.content).toBe("It is a relocation plan.");
    // Trace survives → "Show work" still renders the consolidated steps.
    expect(answer.trace).toEqual([
      { kind: "thinking", text: "Let me look." },
      {
        kind: "tool",
        tool: {
          id: "t1",
          name: "read_file",
          status: "done",
          input: '{"path":"a.md"}',
          output: "ok: 10 lines",
        },
      },
    ]);
    expect(answer.stats).toEqual({ totalTokens: 21956, coins: 0.05 });
  });

  it("resetChatThread clears messages + run state, keeps context", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md"]);
    const withContext = setCurrentTabContext(workspace.chatThread, workspace.id, "a.md");
    const runId = "run-1";
    const used = finalizeBobRun(
      appendAssistantText(
        markBobRunStreaming(
          startBobRun(appendUserChatMessage(withContext, "hi", null), runId),
          runId,
        ),
        runId,
        "done",
      ),
      runId,
      { exitCode: 0 },
    );
    const reset = resetChatThread(used);
    expect(reset.messages).toEqual([]);
    expect(reset.runState).toBe("idle");
    expect(reset.conversationId).toBeNull();
    // The open-file context survives a New chat.
    expect(reset.contextItems.map((item) => item.path)).toEqual(["a.md"]);
  });

  it("createPromptWithContext replays prior request/answer turns, excludes trace", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    let thread = markBobRunStreaming(
      startBobRun(appendUserChatMessage(workspace.chatThread, "first question", null), runId),
      runId,
    );
    thread = appendAssistantThinking(thread, runId, "secret reasoning");
    thread = appendAssistantText(thread, runId, "first answer");
    thread = finalizeBobRun(thread, runId, { exitCode: 0 });

    const prompt = createPromptWithContext("second question", [], thread.messages);
    expect(prompt).toContain("Conversation so far:");
    expect(prompt).toContain("User: first question");
    expect(prompt).toContain("Assistant: first answer");
    // The new prompt comes last; the trace is never replayed.
    expect(prompt.endsWith("second question")).toBe(true);
    expect(prompt).not.toContain("secret reasoning");
  });

  it("createPromptWithContext caps the replayed transcript", () => {
    const many = Array.from({ length: CONVERSATION_REPLAY_LIMIT + 6 }, (_, index) => ({
      activity: null,
      content: `turn ${index}`,
      id: `m${index}`,
      role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
    }));
    const prompt = createPromptWithContext("now", [], many);
    // Oldest dropped, newest kept.
    expect(prompt).not.toContain("turn 0");
    expect(prompt).toContain(`turn ${CONVERSATION_REPLAY_LIMIT + 5}`);
  });

  it("createPromptWithContext with no prior turns and no context is just the prompt", () => {
    expect(createPromptWithContext("hello", [])).toBe("hello");
  });
});
