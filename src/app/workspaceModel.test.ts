import { describe, expect, it } from "vitest";
import {
  reorderOpenTabs,
  removeWorkspaceFolder,
  renameContextItemPath,
  type WorkspaceChatThread,
  acceptWorkspaceSuggestion,
  appendAssistantText,
  appendAssistantNotice,
  appendAssistantSuggestions,
  appendAppliedChanges,
  appendReviewChangeSuggestions,
  markWorkspaceSuggestion,
  assistantMessageContentForRun,
  appendUserChatMessage,
  appendAssistantThinking,
  endAssistantToolCall,
  setAssistantSession,
  setAssistantStats,
  startAssistantToolCall,
  addFileContextItem,
  buildFileContextBlock,
  createPromptWithContext,
  FILE_CONTEXT_INLINE_LIMIT,
  hydrateChatThread,
  missingFileContextPaths,
  removeContextItem,
  type WorkspaceContextItem,
  resetChatThread,
  serializeChatMessages,
  CONVERSATION_REPLAY_LIMIT,
  applyFileBuffer,
  applyFsEvent,
  removeDeletedFile,
  applyScanResult,
  closeWorkspaceFileTab,
  isActiveFilePresent,
  resolveOpenTabs,
  createLlmContextSnapshots,
  createWorkspaceFromPath,
  createWorkspaceFromRecord,
  dismissBufferConflict,
  finalizeRun,
  hydrateWorkspaceRecords,
  isSetupComplete,
  markRunStreaming,
  markBufferConflict,
  markBufferDirty,
  markBufferSaved,
  openWorkspaceFile,
  prepareWorkspaceSuggestionDrafts,
  rejectWorkspaceSuggestion,
  setAssistantActivity,
  setCommentChatContext,
  setCurrentTabContext,
  startRun,
  type Workspace,
  type WorkspaceFileContextItem,
  type WorkspaceFileEntry,
} from "./workspaceModel";
import type { HarnessReadiness } from "../lib/ipc/harnessClient";

function makeEntry(relativePath: string, lastModifiedMs = 1_000): WorkspaceFileEntry {
  return { relativePath, lastModifiedMs, sizeBytes: 16 };
}

function selectedHarnessReadiness(installed: boolean): HarnessReadiness {
  return {
    harnessId: "bob",
    ready: installed,
    installed,
    version: installed ? "1.0.4" : null,
    authConfigured: false,
    error: null,
    details: null,
  };
}

function workspaceWithFiles(path: string, files: string[]): Workspace {
  return applyScanResult(
    createWorkspaceFromPath(path),
    files.map((file) => makeEntry(file)),
  );
}

describe("workspace model", () => {
  it("blocks first-run entry until the selected harness is installed and one workspace exists", () => {
    expect(isSetupComplete(null, [])).toBe(false);
    expect(isSetupComplete(selectedHarnessReadiness(false), [])).toBe(false);
    expect(isSetupComplete(selectedHarnessReadiness(true), [])).toBe(false);
    expect(
      isSetupComplete(selectedHarnessReadiness(false), [createWorkspaceFromPath("/tmp/project")]),
    ).toBe(false);
    expect(
      isSetupComplete(selectedHarnessReadiness(true), [createWorkspaceFromPath("/tmp/project")]),
    ).toBe(true);
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

  it("opens tabs as navigation only — it does not bind chat context to the active tab", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md", "b.md", "c.md"]);
    const first = workspace.files[0].relativePath;
    const second = workspace.files[1].relativePath;
    const firstOpen = openWorkspaceFile(workspace, first);
    const secondOpen = openWorkspaceFile(firstOpen, second);

    expect(secondOpen.openFilePaths).toEqual([first, second]);
    expect(secondOpen.activeFilePath).toBe(second);
    // Opening / switching tabs must NOT repoint the chat context (#30); the
    // user controls it explicitly, and it's seeded at load / new chat instead.
    expect(secondOpen.chatThread.contextItems).toHaveLength(0);
  });

  it("keeps the chat context pinned when switching tabs", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md", "b.md"]);
    const pinned = {
      ...workspace,
      chatThread: setCurrentTabContext(workspace.chatThread, workspace.id, "a.md"),
    };
    const switched = openWorkspaceFile(pinned, "b.md");
    expect(switched.activeFilePath).toBe("b.md");
    expect(switched.chatThread.contextItems.map((item) => item.path)).toEqual(["a.md"]);
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

  it("closes the active tab and drops its buffer, leaving the chat context untouched", () => {
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
    const pinned = {
      ...withTabs,
      chatThread: setCurrentTabContext(withTabs.chatThread, withTabs.id, a),
    };

    expect(Object.keys(pinned.fileContents)).toHaveLength(3);

    const closed = closeWorkspaceFileTab(pinned, c);
    expect(closed.openFilePaths).toEqual([a, b]);
    expect(closed.activeFilePath).toBe(b);
    // Closing a tab is navigation only — the pinned chat context is untouched (#30).
    expect(closed.chatThread.contextItems.map((item) => item.path)).toEqual([a]);
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
    // Message ids are globally-unique (UUIDs), not a per-conversation `message-N`
    // sequence — `seq` already orders them, and the DB PK is global.
    expect(chatThread.messages[0].id).toEqual(expect.any(String));
    expect(chatThread.messages).toEqual([
      {
        activity: null,
        content: "Summarize this note",
        id: chatThread.messages[0].id,
        role: "user",
      },
    ]);
  });

  it("gives each message a globally-unique id, not a per-conversation message-N", () => {
    // `conversation_messages.message_id` is a global primary key, so two
    // different conversations' first messages must not share an id (the old
    // `message-${n}` scheme collided the moment a second conversation saved).
    const a = appendUserChatMessage(createWorkspaceFromPath("/tmp/a").chatThread, "hi", null);
    const b = appendUserChatMessage(createWorkspaceFromPath("/tmp/b").chatThread, "hi", null);
    expect(a.messages[0].id).not.toBe(b.messages[0].id);
    expect(a.messages[0].id).not.toMatch(/^message-\d+$/);
  });

  it("links persisted LLM thread ids to the auditable chat messages", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const llmThreadId = "llm-thread-1";
    const withUser = appendUserChatMessage(workspace.chatThread, "Audit this context", null, llmThreadId);
    const started = startRun(withUser, runId, llmThreadId);
    const streaming = markRunStreaming(started, runId);

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

  it("applyScanResult refreshes the file list without dropping open tabs (a scan miss isn't a deletion)", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md", "b.md"]);
    const opened = applyFileBuffer(
      openWorkspaceFile(openWorkspaceFile(workspace, "a.md"), "b.md"),
      "a.md",
      { content: "# A", lastModifiedMs: 1_500 },
    );

    // b.md is absent from this scan (a partial/racing scan). Its tab + the active
    // file must survive — only a confirmed `removed` event closes a tab.
    const rescanned = applyScanResult(opened, [makeEntry("a.md", 2_000), makeEntry("c.md")]);

    expect(rescanned.files.map((entry) => entry.relativePath)).toEqual(["a.md", "c.md"]);
    expect(rescanned.openFilePaths).toEqual(["a.md", "b.md"]);
    expect(rescanned.activeFilePath).toBe("b.md");
    expect(rescanned.fileContents["a.md"].content).toBe("# A");

    // The rendered tab strip + the active-document gate must ALSO survive: both
    // key off the open paths / buffer, not `files` membership, so a tab whose
    // file is transiently absent from the scan keeps rendering (bug #14).
    expect(resolveOpenTabs(rescanned).map((entry) => entry.relativePath)).toEqual([
      "a.md",
      "b.md",
    ]);
    expect(isActiveFilePresent(rescanned)).toBe(true);
  });

  it("resolveOpenTabs renders a tab per open path even when its file is absent from the scan", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md"]);
    // b.md is open (e.g. restored) but not yet/again in `files` — a partial scan.
    const opened = openWorkspaceFile(openWorkspaceFile(workspace, "a.md"), "b.md");

    const tabs = resolveOpenTabs(opened);
    // One tab per open path, in order — the missing file gets a synthesized
    // entry rather than being dropped from the strip.
    expect(tabs.map((entry) => entry.relativePath)).toEqual(["a.md", "b.md"]);
    // The real entry is used where present; the synthesized one carries the path.
    expect(tabs[0]).toEqual(makeEntry("a.md"));
    expect(tabs[1].relativePath).toBe("b.md");
  });

  it("isActiveFilePresent holds an open document through a transient scan miss", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md"]);
    const opened = applyFileBuffer(openWorkspaceFile(workspace, "a.md"), "a.md", {
      content: "# A",
      lastModifiedMs: 1_000,
    });

    // The active file vanished from `files` (a racing/partial scan) but is still
    // open with a loaded buffer — the document must stay, not fall to Welcome.
    const afterMiss = applyScanResult(opened, [makeEntry("c.md")]);
    expect(afterMiss.files.map((entry) => entry.relativePath)).toEqual(["c.md"]);
    expect(isActiveFilePresent(afterMiss)).toBe(true);

    // No active file → not present (the empty/Welcome state is correct).
    expect(isActiveFilePresent(workspaceWithFiles("/tmp/beta", ["x.md"]))).toBe(false);

    // A confirmed deletion closes the tab → then it's genuinely not present.
    const { workspace: afterDelete } = applyFsEvent(afterMiss, {
      kind: "removed",
      lastModifiedMs: null,
      relativePath: "a.md",
    });
    expect(afterDelete.openFilePaths).toEqual([]);
    expect(isActiveFilePresent(afterDelete)).toBe(false);
  });

  it("applyFsEvent on a removed file closes that tab (a confirmed deletion)", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md", "b.md"]);
    const opened = openWorkspaceFile(openWorkspaceFile(workspace, "a.md"), "b.md");

    const { workspace: next, effect } = applyFsEvent(opened, {
      kind: "removed",
      lastModifiedMs: null,
      relativePath: "b.md",
    });

    // In-place removal: persist tabs + refresh the index, but no full scan.
    expect(effect.type).toBe("treeChanged");
    expect(next.openFilePaths).toEqual(["a.md"]);
    expect(next.activeFilePath).toBe("a.md");
    expect(next.files.map((entry) => entry.relativePath)).toEqual(["a.md"]);
  });

  it("applyFsEvent on a removed file KEEPS a dirty tab — unsaved work outlives the file", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md", "b.md"]);
    const opened = openWorkspaceFile(openWorkspaceFile(workspace, "a.md"), "b.md");
    const dirty: Workspace = {
      ...opened,
      fileContents: {
        ...opened.fileContents,
        "b.md": {
          conflict: false,
          content: "# unsaved",
          dirty: true,
          lastModifiedMs: 1_000,
          pendingChanges: [],
        },
      },
    };

    const { workspace: next, effect } = applyFsEvent(dirty, {
      kind: "removed",
      lastModifiedMs: null,
      relativePath: "b.md",
    });

    expect(effect.type).toBe("treeChanged");
    // Row gone, tab + buffer intact.
    expect(next.files.map((entry) => entry.relativePath)).toEqual(["a.md"]);
    expect(next.openFilePaths).toEqual(["a.md", "b.md"]);
    expect(next.activeFilePath).toBe("b.md");
    expect(next.fileContents["b.md"].content).toBe("# unsaved");
  });

  it("removeDeletedFile closes the tab and clears the file's context and comments", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md", "b.md", "c.md"]);
    const opened = openWorkspaceFile(openWorkspaceFile(workspace, "a.md"), "b.md");

    const next = removeDeletedFile(opened, "b.md");

    expect(next.files.map((entry) => entry.relativePath)).toEqual(["a.md", "c.md"]);
    expect(next.openFilePaths).toEqual(["a.md"]);
    // Nearest-tab activation lands on a file that still exists.
    expect(next.activeFilePath).toBe("a.md");
    expect(next.fileContents["b.md"]).toBeUndefined();
  });

  it("removeDeletedFile on a background file leaves the active tab alone", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md", "b.md"]);
    const opened = openWorkspaceFile(openWorkspaceFile(workspace, "b.md"), "a.md");

    const next = removeDeletedFile(opened, "b.md");

    expect(next.activeFilePath).toBe("a.md");
    expect(next.openFilePaths).toEqual(["a.md"]);
  });

  it("applyFsEvent patches a created note into the tree without a rescan", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["b.md"]);

    const { workspace: next, effect } = applyFsEvent(workspace, {
      kind: "created",
      lastModifiedMs: 42,
      relativePath: "Notes/a.md",
      isDir: false,
      sizeBytes: 7,
    });

    expect(effect.type).toBe("treeChanged");
    expect(next.files.map((entry) => entry.relativePath)).toEqual(["b.md", "Notes/a.md"]);
    expect(next.files.find((entry) => entry.relativePath === "Notes/a.md")).toMatchObject({
      lastModifiedMs: 42,
      sizeBytes: 7,
    });
    // The containing folder materializes with the note, so the tree can place it.
    expect(next.folders).toContain("Notes");
  });

  it("applyFsEvent treats echoes of our own create/delete as no-ops (same reference)", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md"]);

    // createNote already inserted the entry — the watcher echo changes nothing.
    const created = applyFsEvent(workspace, {
      kind: "created",
      lastModifiedMs: 1,
      relativePath: "a.md",
      isDir: false,
    });
    expect(created.workspace).toBe(workspace);
    expect(created.effect.type).toBe("noop");

    // deleteActiveFile already dropped the path — the echo finds nothing.
    const removed = applyFsEvent(workspace, {
      kind: "removed",
      lastModifiedMs: null,
      relativePath: "gone-already.md",
    });
    expect(removed.workspace).toBe(workspace);
    expect(removed.effect.type).toBe("noop");
  });

  it("applyFsEvent on a removed folder takes its subtree and tabs with it", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["Notes/a.md", "Notes/Deep/b.md", "c.md"]);
    const withFolders = { ...workspace, folders: ["Notes", "Notes/Deep"] };
    const opened = openWorkspaceFile(withFolders, "Notes/Deep/b.md");

    const { workspace: next, effect } = applyFsEvent(opened, {
      kind: "removed",
      lastModifiedMs: null,
      relativePath: "Notes",
    });

    expect(effect.type).toBe("treeChanged");
    expect(next.files.map((entry) => entry.relativePath)).toEqual(["c.md"]);
    expect(next.folders).toEqual([]);
    expect(next.openFilePaths).toEqual([]);
  });

  it("applyFsEvent asks for one rescan for an unknown directory (it may have contents)", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md"]);

    // A folder dragged in via Finder emits only the top-level event — only a
    // scan can see inside it.
    const unknownDir = applyFsEvent(workspace, {
      kind: "created",
      lastModifiedMs: null,
      relativePath: "Imported",
      isDir: true,
    });
    expect(unknownDir.effect.type).toBe("rescan");

    // Our own createFolder echo: the folder is already known — nothing to do.
    const known = applyFsEvent({ ...workspace, folders: ["Imported"] }, {
      kind: "created",
      lastModifiedMs: null,
      relativePath: "Imported",
      isDir: true,
    });
    expect(known.effect.type).toBe("noop");
  });

  it("applyFsEvent maps the watcher's lost-sync signal to a full rescan", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md"]);
    const { workspace: next, effect } = applyFsEvent(workspace, {
      kind: "rescan",
      lastModifiedMs: null,
      relativePath: "",
    });
    expect(next).toBe(workspace);
    expect(effect.type).toBe("rescan");
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

  it("applyFsEvent auto-reloads a dirty buffer when the change is agent-driven", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md"]);
    const opened = applyFileBuffer(openWorkspaceFile(workspace, "a.md"), "a.md", {
      content: "# A",
      lastModifiedMs: 1_000,
    });
    const dirty = markBufferDirty(opened, "a.md", "# A edited");

    // agentEdit = true ⇒ the agent's own intended edit, so no conflict banner;
    // we reload to the new content instead (undoable via version history).
    const { workspace: next, effect } = applyFsEvent(
      dirty,
      { kind: "modified", lastModifiedMs: 5_000, relativePath: "a.md" },
      true,
    );

    expect(effect).toEqual({ type: "reloadFile", relativePath: "a.md" });
    expect(next.fileContents["a.md"].conflict).toBe(false);
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

  it("missingFileContextPaths flags context files gone from the tree, nothing else", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["kept.md"]);
    const items = [
      { id: "1", kind: "file" as const, label: "kept.md", path: "kept.md", workspaceId: "w" },
      { id: "2", kind: "file" as const, label: "gone.md", path: "gone.md", workspaceId: "w" },
      // Only `kind` matters to the helper — the anchor internals are noise here.
      { id: "3", kind: "comment", filePath: "gone.md" } as unknown as WorkspaceContextItem,
    ];

    // Only the FILE item whose path left the tree — comment items are anchored
    // history, not attachments to re-read.
    expect(missingFileContextPaths(items, workspace.files)).toEqual(["gone.md"]);
    expect(missingFileContextPaths(items.slice(0, 1), workspace.files)).toEqual([]);
  });

  it("missingFileContextPaths judges external chips by the external list, spills by nothing", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["kept.md"]);
    const looseFiles = [{ lastModifiedMs: 0, relativePath: "/Users/x/listed.md", sizeBytes: 0 }];
    const items: WorkspaceContextItem[] = [
      {
        id: "1",
        kind: "file",
        label: "listed.md",
        path: "/Users/x/listed.md",
        workspaceId: "w",
        origin: "external",
      },
      {
        id: "2",
        kind: "file",
        label: "removed.md",
        path: "/Users/x/removed.md",
        workspaceId: "w",
        origin: "external",
      },
      // A spilled paste: absolute path in app scratch, no origin — outside
      // every tree by design, never "missing".
      { id: "3", kind: "file", label: "42 KB paste", path: "/tmp/spill/x.md", workspaceId: "w" },
    ];

    expect(missingFileContextPaths(items, workspace.files, looseFiles)).toEqual([
      "/Users/x/removed.md",
    ]);
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

  it("startRun → markRunStreaming → appendAssistantText builds a streaming reply", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const t1 = appendUserChatMessage(workspace.chatThread, "Hi Bob", null);
    const t2 = startRun(t1, runId, "llm-thread-1");
    expect(t2.runState).toBe("starting");
    expect(t2.activeRunId).toBe(runId);
    expect(t2.activeLlmThreadId).toBe("llm-thread-1");

    const t3 = markRunStreaming(t2, runId);
    expect(t3.runState).toBe("streaming");
    expect(t3.messages[t3.messages.length - 1]?.role).toBe("assistant");
    expect(t3.messages[t3.messages.length - 1]?.streaming).toBe(true);

    const t4 = appendAssistantText(appendAssistantText(t3, runId, "Hello "), runId, "world");
    expect(t4.messages[t4.messages.length - 1]?.content).toBe("Hello world");
    expect(assistantMessageContentForRun(t4, runId)).toBe("Hello world");
  });

  it("finalizeRun marks success and clears the streaming flag", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const streaming = appendAssistantText(
      markRunStreaming(startRun(workspace.chatThread, runId), runId),
      runId,
      "done",
    );
    const finalized = finalizeRun(streaming, runId, { exitCode: 0 });
    expect(finalized.runState).toBe("idle");
    expect(finalized.activeRunId).toBeNull();
    expect(finalized.activeLlmThreadId).toBeNull();
    expect(finalized.messages[finalized.messages.length - 1]?.streaming).toBe(false);
    expect(finalized.runError).toBeNull();
  });

  it("finalizeRun surfaces a runError on non-zero exit", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const streaming = markRunStreaming(startRun(workspace.chatThread, runId), runId);

    const failed = finalizeRun(streaming, runId, { exitCode: 2 });
    expect(failed.runState).toBe("error");
    expect(failed.runError).toContain("2");
  });

  it("finalizeRun surfaces an in-band errorMessage as the runError", () => {
    // The path a failing codex/claude run takes: a ChatEvent::Error (now
    // produced by agent-harness 0.3.0 from codex's turn.failed/error) →
    // finalize({ errorMessage }). The message must reach runError + the
    // assistant trace, not vanish — the run is shown as errored, not silent.
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const streaming = markRunStreaming(startRun(workspace.chatThread, runId), runId);

    const failed = finalizeRun(streaming, runId, { errorMessage: "quota exceeded" });
    expect(failed.runState).toBe("error");
    expect(failed.runError).toBe("quota exceeded");
    expect(failed.activeRunId).toBeNull();
    const lastAssistant = failed.messages[failed.messages.length - 1];
    expect(lastAssistant?.streaming).toBe(false);
    expect(lastAssistant?.activity).toBe("quota exceeded");
  });

  it("setAssistantActivity attaches a status line to the latest assistant message", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const streaming = markRunStreaming(startRun(workspace.chatThread, runId), runId);

    const annotated = setAssistantActivity(streaming, runId, "Reading notes/a.md");
    expect(annotated.messages[annotated.messages.length - 1]?.activity).toBe("Reading notes/a.md");
  });

  it("concatenates narration deltas into one ordered trace entry, never the answer", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const streaming = markRunStreaming(startRun(workspace.chatThread, runId), runId);

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
    let thread = markRunStreaming(startRun(workspace.chatThread, runId), runId);
    thread = appendAssistantNotice(thread, runId, "Reading the notes.");
    thread = startAssistantToolCall(thread, runId, "t1", "read_file", "read", "{}");
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
    let thread = markRunStreaming(startRun(workspace.chatThread, runId), runId);
    thread = appendAssistantThinking(thread, runId, "Let me ");
    thread = appendAssistantThinking(thread, runId, "look.");
    thread = appendAssistantNotice(thread, runId, "Reading the notes.");
    thread = startAssistantToolCall(thread, runId, "t1", "read_file", "read", '{"path":"a.md"}');
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
          kind: "read",
          status: "done",
          input: '{"path":"a.md"}',
          output: "ok: 10 lines",
        },
      },
    ]);

    // The trace survives finalize.
    const finalized = finalizeRun(thread, runId, { exitCode: 0 });
    expect(finalized.messages[finalized.messages.length - 1]?.trace).toHaveLength(3);
  });

  it("records session id and usage stats on the assistant message", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const streaming = markRunStreaming(startRun(workspace.chatThread, runId), runId);
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
    const started = startRun(
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
        kind: "replace",
        createdAt: 123,
        filePath: "a.md",
        id: withSuggestion.messages[1].suggestions![0].id,
        originalText: "Old title",
        range: { start: 2, end: 11 },
        replacement: "Launch plan",
        runId: "run-1",
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
    const started = startRun(appendUserChatMessage(base.chatThread, "Improve title", null), runId);
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

    const suggestionId = withSuggestion.chatThread.messages[1].suggestions![0].id;
    const accepted = acceptWorkspaceSuggestion(withSuggestion, suggestionId, 456);

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
    const started = startRun(appendUserChatMessage(base.chatThread, "Improve title", null), runId);
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

    const suggestionId = withSuggestion.chatThread.messages[1].suggestions![0].id;
    const accepted = acceptWorkspaceSuggestion(changed, suggestionId, 456);

    expect(accepted.fileContents["a.md"].content).toBe("# Changed\n");
    expect(accepted.chatThread.messages[1].suggestions?.[0]).toMatchObject({
      status: "stale",
      statusMessage: "Source changed since this edit was suggested.",
    });
  });

  it("rejectWorkspaceSuggestion records rejection without mutating the document", () => {
    const base = applyFileBuffer(
      openWorkspaceFile(workspaceWithFiles("/tmp/alpha", ["a.md"]), "a.md"),
      "a.md",
      { content: "# Old title\n", lastModifiedMs: 1_000 },
    );
    const runId = "run-1";
    const started = startRun(appendUserChatMessage(base.chatThread, "Improve title", null), runId);
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

    const suggestionId = withSuggestion.chatThread.messages[1].suggestions![0].id;
    const rejected = rejectWorkspaceSuggestion(withSuggestion, suggestionId, 456);

    expect(rejected.fileContents["a.md"].content).toBe("# Old title\n");
    expect(rejected.chatThread.messages[1].suggestions?.[0]).toMatchObject({
      status: "rejected",
      updatedAt: 456,
    });
  });

  it("appendReviewChangeSuggestions attaches file-level changes to the run's message", () => {
    const base = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const started = appendAssistantText(
      startRun(appendUserChatMessage(base.chatThread, "Edit my notes", null), runId),
      runId,
      "Done.",
    );
    const withChanges = appendReviewChangeSuggestions(
      started,
      runId,
      [
        {
          kind: "create",
          filePath: "new.md",
          originalText: null,
          newText: "hi",
          originalSize: 0,
          newSize: 2,
          previewOmitted: false,
          stale: false,
        },
        {
          kind: "rewrite",
          filePath: "edit.md",
          originalText: "old",
          newText: "new",
          originalSize: 3,
          newSize: 3,
          previewOmitted: false,
          stale: true,
        },
        {
          kind: "delete",
          filePath: "gone.md",
          originalText: "bye",
          newText: null,
          originalSize: 3,
          newSize: 0,
          previewOmitted: false,
          stale: false,
        },
      ],
      200,
    );

    const suggestions = withChanges.messages[1].suggestions ?? [];
    expect(suggestions.map((s) => [s.kind, s.filePath])).toEqual([
      ["create", "new.md"],
      ["rewrite", "edit.md"],
      ["delete", "gone.md"],
    ]);
    expect(suggestions.every((s) => s.status === "pending" && s.runId === runId)).toBe(true);
    const rewrite = suggestions.find((s) => s.kind === "rewrite");
    expect(rewrite?.kind === "rewrite" && rewrite.stale).toBe(true);
  });

  it("appendAppliedChanges attaches already-applied changes as informational diffs", () => {
    const base = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const started = appendAssistantText(
      startRun(appendUserChatMessage(base.chatThread, "Edit my notes", null), runId),
      runId,
      "Done.",
    );
    const withChanges = appendAppliedChanges(started, runId, [
      {
        kind: "create",
        filePath: "new.md",
        originalText: null,
        newText: "hi",
        originalSize: 0,
        newSize: 2,
        previewOmitted: false,
        stale: false,
      },
      {
        kind: "rewrite",
        filePath: "edit.md",
        originalText: "old",
        newText: "new",
        originalSize: 3,
        newSize: 3,
        previewOmitted: false,
        stale: true,
      },
    ]);

    const applied = withChanges.messages[1].appliedChanges ?? [];
    expect(applied.map((c) => [c.kind, c.filePath])).toEqual([
      ["create", "new.md"],
      ["rewrite", "edit.md"],
    ]);
    // Informational, not pending: no suggestions, and the draft's `stale` flag
    // (meaningless for an already-applied change) is dropped.
    expect(withChanges.messages[1].suggestions ?? []).toHaveLength(0);
    expect(applied[1]).not.toHaveProperty("stale");
    expect(withChanges.messages[1].activity).toBe("2 files changed");
  });

  it("acceptWorkspaceSuggestion leaves file-level changes to the store; markWorkspaceSuggestion records the result", () => {
    const base = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-1";
    const chatThread = appendReviewChangeSuggestions(
      appendAssistantText(
        startRun(appendUserChatMessage(base.chatThread, "x", null), runId),
        runId,
        "Done.",
      ),
      runId,
      [
        {
          kind: "create",
          filePath: "new.md",
          originalText: null,
          newText: "hi",
          originalSize: 0,
          newSize: 2,
          previewOmitted: false,
          stale: false,
        },
      ],
      200,
    );
    const workspace = { ...base, chatThread };

    // File-level kinds don't touch the in-memory buffer here — the store
    // applies them to disk through the review session, so accept is a no-op.
    const suggestionId = workspace.chatThread.messages[1].suggestions![0].id;
    const untouched = acceptWorkspaceSuggestion(workspace, suggestionId, 300);
    expect(untouched.chatThread.messages[1].suggestions?.[0]?.status).toBe("pending");
    expect(untouched.fileContents).toEqual(base.fileContents);

    // The store records the outcome after applying on disk.
    const marked = markWorkspaceSuggestion(workspace, suggestionId, "accepted", null, 300);
    expect(marked.chatThread.messages[1].suggestions?.[0]).toMatchObject({
      status: "accepted",
      updatedAt: 300,
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
    let thread = markRunStreaming(
      startRun(appendUserChatMessage(workspace.chatThread, "what is this about?", null), runId),
      runId,
    );
    thread = appendAssistantThinking(thread, runId, "Let me look.");
    thread = startAssistantToolCall(thread, runId, "t1", "read_file", "read", '{"path":"a.md"}');
    thread = endAssistantToolCall(thread, runId, "t1", true, "ok: 10 lines");
    thread = appendAssistantText(thread, runId, "It is a relocation plan.");
    thread = setAssistantStats(thread, runId, { totalTokens: 21956, coins: 0.05 });
    thread = finalizeRun(thread, runId, { exitCode: 0 });
    thread = { ...thread, conversationId: "conv-1" };

    const records = serializeChatMessages(thread);
    // Only settled turns (with content): the user + the answer.
    expect(records.map((r) => r.role)).toEqual(["user", "assistant"]);

    const snapshot = {
      conversationId: "conv-1",
      title: null,
      harnessId: "bob",
      contextFiles: [],
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
          kind: "read",
          status: "done",
          input: '{"path":"a.md"}',
          output: "ok: 10 lines",
        },
      },
    ]);
    expect(answer.stats).toEqual({ totalTokens: 21956, coins: 0.05 });
  });

  it("serialize → hydrate round-trips a comment's excerpt card", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const excerpt = {
      filePath: "Others/Writing/data-science-nigeria-video.md",
      line: 39,
      column: 1,
      text: "Hi, I'm Tosin Amuda.",
      note: "is this relevant?",
    };
    const thread = {
      ...appendUserChatMessage(workspace.chatThread, "About this excerpt…", null, null, excerpt),
      conversationId: "conv-x",
    };

    const records = serializeChatMessages(thread);
    // The excerpt is serialized onto the persisted record...
    expect(records[0].excerptJson).toBe(JSON.stringify(excerpt));

    const restored = hydrateChatThread(createWorkspaceFromPath("/tmp/alpha").chatThread, {
      conversationId: "conv-x",
      title: null,
      harnessId: "bob",
      contextFiles: [],
      messages: records,
      createdAt: 0,
      updatedAt: 1,
    });
    // ...and rebuilt on load, so the chat renders the card, not the raw prompt text.
    expect(restored.messages[0].excerpt).toEqual(excerpt);
  });

  it("persists a live reply as streaming; loads a stale one as interrupted", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-2";
    // A reply that streamed partial text but never finalized — the app quit or
    // crashed mid-stream.
    let thread = markRunStreaming(
      startRun(appendUserChatMessage(workspace.chatThread, "summarize", null), runId),
      runId,
    );
    thread = appendAssistantText(thread, runId, "Here is the par");
    thread = { ...thread, conversationId: "conv-2" };

    const records = serializeChatMessages(thread);
    // The in-flight reply is persisted (not skipped) and tagged streaming, so a
    // crash leaves a marker on disk instead of losing the turn.
    const answer = records.find((record) => record.role === "assistant");
    expect(answer?.runStatus).toBe("streaming");

    // Loading it in a fresh session (no live run) reads the stale streaming
    // marker as an interrupted reply — surfaced with a Retry, not a dead spinner.
    const snapshot = {
      conversationId: "conv-2",
      title: null,
      harnessId: "bob",
      contextFiles: [],
      messages: records,
      createdAt: 0,
      updatedAt: 1,
    };
    const restored = hydrateChatThread(createWorkspaceFromPath("/tmp/alpha").chatThread, snapshot);
    const restoredAnswer = restored.messages[1];
    expect(restoredAnswer.interrupted).toBe(true);
    expect(restoredAnswer.streaming).toBeUndefined();
    expect(restoredAnswer.content).toBe("Here is the par");
  });

  it("leaves a settled reply unmarked, so it never reads as interrupted", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const runId = "run-3";
    let thread = markRunStreaming(
      startRun(appendUserChatMessage(workspace.chatThread, "q", null), runId),
      runId,
    );
    thread = appendAssistantText(thread, runId, "done");
    thread = finalizeRun(thread, runId, { exitCode: 0 });
    thread = { ...thread, conversationId: "conv-3" };

    const records = serializeChatMessages(thread);
    expect(records.every((record) => record.runStatus == null)).toBe(true);

    const restored = hydrateChatThread(createWorkspaceFromPath("/tmp/alpha").chatThread, {
      conversationId: "conv-3",
      title: null,
      harnessId: null,
      contextFiles: [],
      messages: records,
      createdAt: 0,
      updatedAt: 1,
    });
    expect(restored.messages.some((message) => message.interrupted)).toBe(false);
  });

  it("resetChatThread clears messages + run state, keeps context", () => {
    const workspace = workspaceWithFiles("/tmp/alpha", ["a.md"]);
    const withContext = setCurrentTabContext(workspace.chatThread, workspace.id, "a.md");
    const runId = "run-1";
    const used = finalizeRun(
      appendAssistantText(
        markRunStreaming(
          startRun(appendUserChatMessage(withContext, "hi", null), runId),
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
    let thread = markRunStreaming(
      startRun(appendUserChatMessage(workspace.chatThread, "first question", null), runId),
      runId,
    );
    thread = appendAssistantThinking(thread, runId, "secret reasoning");
    thread = appendAssistantText(thread, runId, "first answer");
    thread = finalizeRun(thread, runId, { exitCode: 0 });

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

  it("buildFileContextBlock inlines small file content and references large ones", () => {
    const fileItem = (path: string): WorkspaceFileContextItem => ({
      id: path,
      kind: "file",
      label: path,
      path,
      workspaceId: "w1",
    });
    const big = "x".repeat(FILE_CONTEXT_INLINE_LIMIT + 1);
    const block = buildFileContextBlock(
      [fileItem("small.md"), fileItem("big.md"), fileItem("missing.md")],
      new Map([
        ["small.md", "hello world"],
        ["big.md", big],
      ]),
    );
    // Small file: inlined under a `### <path>` heading with its content.
    expect(block).toContain("### small.md\nhello world");
    // Large file: referenced by path, content withheld (read on demand).
    expect(block).toContain("- big.md (large; read it for details)");
    expect(block).not.toContain(big);
    // Path with no content in the map also degrades to a reference.
    expect(block).toContain("- missing.md (large; read it for details)");
  });

  it("buildFileContextBlock inlines a large EXTERNAL file's head — its path is unreadable by the sandboxed tools", () => {
    const external: WorkspaceFileContextItem = {
      id: "/Users/x/big.md",
      kind: "file",
      label: "big.md",
      path: "/Users/x/big.md",
      workspaceId: "w1",
      origin: "external",
    };
    const big = "y".repeat(FILE_CONTEXT_INLINE_LIMIT * 2);
    const block = buildFileContextBlock([external], new Map([["/Users/x/big.md", big]]));

    expect(block).toContain("### /Users/x/big.md (beginning of the file");
    expect(block).toContain("y".repeat(FILE_CONTEXT_INLINE_LIMIT));
    expect(block).not.toContain(big);
    expect(block).not.toContain("read it for details");
  });

  it("buildFileContextBlock references every file (no inlined content) when inlineContent is off", () => {
    const fileItem = (path: string): WorkspaceFileContextItem => ({
      id: path,
      kind: "file",
      label: path,
      path,
      workspaceId: "w1",
    });
    // Tool-native CLI agent: even a small file is a bare path reference it reads.
    const block = buildFileContextBlock(
      [fileItem("a.md"), fileItem("b.md")],
      new Map([
        ["a.md", "hello world"],
        ["b.md", "more"],
      ]),
      FILE_CONTEXT_INLINE_LIMIT,
      false,
    );
    expect(block).toBe("- a.md\n\n- b.md");
    expect(block).not.toContain("hello world");
    expect(block).not.toContain("###");
  });

  it("createPromptWithContext labels the references for read-on-demand when not inlining", () => {
    const fileItem = (path: string): WorkspaceFileContextItem => ({
      id: path,
      kind: "file",
      label: path,
      path,
      workspaceId: "w1",
    });
    const prompt = createPromptWithContext("do the thing", [fileItem("a.md")], [], new Map(), false);
    expect(prompt).toContain("Context files (read these as needed):");
    expect(prompt).toContain("- a.md");
  });

  it("addFileContextItem adds a labelled chip and dedupes by path", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const added = addFileContextItem(
      workspace.chatThread,
      workspace.id,
      "/scratch/paste-1.md",
      "Pasted text (12 KB)",
    );
    expect(added.contextItems).toHaveLength(1);
    expect(added.contextItems[0]).toMatchObject({
      kind: "file",
      label: "Pasted text (12 KB)",
      path: "/scratch/paste-1.md",
    });
    // Re-adding the same path replaces (keeps one chip, updates the label).
    const again = addFileContextItem(added, workspace.id, "/scratch/paste-1.md", "Pasted text (13 KB)");
    expect(again.contextItems).toHaveLength(1);
    expect(again.contextItems[0].label).toBe("Pasted text (13 KB)");
  });

  it("removeContextItem drops the chip with the given id", () => {
    const workspace = createWorkspaceFromPath("/tmp/alpha");
    const added = addFileContextItem(workspace.chatThread, workspace.id, "/scratch/p.md", "Pasted");
    const id = added.contextItems[0].id;
    expect(removeContextItem(added, id).contextItems).toHaveLength(0);
    // Unknown id is a no-op.
    expect(removeContextItem(added, "nope").contextItems).toHaveLength(1);
  });

  it("createPromptWithContext inlines attached file content from the content map", () => {
    const fileItem: WorkspaceFileContextItem = {
      id: "notes/a.md",
      kind: "file",
      label: "notes/a.md",
      path: "notes/a.md",
      workspaceId: "w1",
    };
    const prompt = createPromptWithContext(
      "summarize this",
      [fileItem],
      [],
      new Map([["notes/a.md", "the file body"]]),
    );
    expect(prompt).toContain("Context files:");
    expect(prompt).toContain("### notes/a.md\nthe file body");
    // Edit-scope guardrail so the agent only touches the intended files (#31).
    expect(prompt).toContain("only modify the Context files listed above");
    expect(prompt.endsWith("summarize this")).toBe(true);
  });
});

describe("renameContextItemPath comment items (#32)", () => {
  it("re-points a comment context item's filePath so the agent reads the new path", () => {
    const thread = {
      activeLlmThreadId: null,
      activeRunId: null,
      conversationId: null,
      contextItems: [
        {
          kind: "comment",
          filePath: "old.md",
          path: "old.md",
          id: "c1",
          label: "excerpt",
          workspaceId: "w",
          commentBody: "",
          selectedText: "",
          surroundingContext: "",
          anchor: { from: 0, to: 0 },
          range: { start: 0, end: 0 },
        },
      ],
      messages: [],
      preparedCommand: null,
      prompt: "",
      runError: null,
      runState: "idle",
    } as unknown as WorkspaceChatThread;

    const result = renameContextItemPath(thread, "w", "old.md", "new.md");
    const item = result.contextItems[0] as { kind: string; filePath: string; path: string };
    expect(item.kind).toBe("comment");
    expect(item.filePath).toBe("new.md");
    expect(item.path).toBe("new.md");
  });
});

describe("removeWorkspaceFolder (#55)", () => {
  it("prunes files, folders, buffers, tabs, context, and comments under the path", () => {
    const buffer = { content: "", lastModifiedMs: 0, dirty: false, conflict: false, pendingChanges: [] };
    const workspace = {
      activeFilePath: "Talks/a.md",
      openFilePaths: ["Talks/a.md", "Other/c.md"],
      files: [
        { relativePath: "Talks/a.md", lastModifiedMs: 0, sizeBytes: 0 },
        { relativePath: "Talks/sub/b.md", lastModifiedMs: 0, sizeBytes: 0 },
        { relativePath: "Other/c.md", lastModifiedMs: 0, sizeBytes: 0 },
      ],
      folders: ["Talks", "Talks/sub", "Other"],
      fileContents: { "Talks/a.md": buffer, "Other/c.md": buffer },
      chatThread: {
        contextItems: [
          { kind: "file", path: "Talks/a.md", id: "x", label: "Talks/a.md", workspaceId: "w" },
        ],
        messages: [],
      },
      comments: [{ filePath: "Talks/a.md" }, { filePath: "Other/c.md" }],
    } as unknown as Workspace;

    const result = removeWorkspaceFolder(workspace, "Talks");

    expect(result.files.map((entry) => entry.relativePath)).toEqual(["Other/c.md"]);
    expect(result.folders).toEqual(["Other"]);
    expect(result.fileContents["Talks/a.md"]).toBeUndefined();
    expect(result.openFilePaths).toEqual(["Other/c.md"]);
    expect(result.activeFilePath).toBe("Other/c.md"); // moved off the deleted active file
    expect(result.chatThread.contextItems).toHaveLength(0);
    expect(result.comments.map((comment) => comment.filePath)).toEqual(["Other/c.md"]);
  });
});

describe("reorderOpenTabs (#29)", () => {
  it("moves a tab to sit just before the drop target", () => {
    expect(reorderOpenTabs(["a", "b", "c"], "a", "c")).toEqual(["b", "a", "c"]);
    expect(reorderOpenTabs(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
  });

  it("is a no-op for the same tab or an unknown path", () => {
    expect(reorderOpenTabs(["a", "b"], "a", "a")).toEqual(["a", "b"]);
    expect(reorderOpenTabs(["a", "b"], "a", "z")).toEqual(["a", "b"]);
    expect(reorderOpenTabs(["a", "b"], "z", "a")).toEqual(["a", "b"]);
  });
});
