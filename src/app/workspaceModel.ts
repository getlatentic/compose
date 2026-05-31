import {
  applyDocumentChangesToComments,
  createCommentThread,
  moveCommentsToFile,
  PositionMapper,
  type CommentAnchor,
  type DocumentTextChange,
  type SourceRange,
  type WorkspaceCommentThread,
} from "../features/comments/commentModel";
import type {
  ConversationMessageRecord,
  ConversationSnapshot,
} from "../lib/ipc/conversationsClient";
import type { WorkspaceIndexSnapshot } from "../lib/ipc/indexClient";
import type { BobInstallStatus } from "../lib/ipc/settingsClient";

export type {
  DocumentTextChange,
  SourceRange,
  WorkspaceCommentThread,
} from "../features/comments/commentModel";

export interface BobAuthStatus {
  configured: boolean;
  errorMessage?: string;
}

export interface BobRuntimeReadiness {
  message: string | null;
  ready: boolean;
}

export type WorkspaceContextItem = WorkspaceFileContextItem | WorkspaceCommentContextItem;

export interface WorkspaceFileContextItem {
  id: string;
  kind: "file";
  label: string;
  path: string;
  workspaceId: string;
}

export interface WorkspaceCommentContextItem {
  anchor: CommentAnchor;
  commentBody: string;
  filePath: string;
  id: string;
  kind: "comment";
  label: string;
  path: string;
  range: SourceRange;
  selectedText: string;
  surroundingContext: string;
  workspaceId: string;
}

export type LlmContextSnapshotInput =
  | {
      filePath: string;
      kind: "file";
      sourceCommentId?: never;
      anchor?: never;
      selectedTextSnapshot?: never;
      sourceRange?: never;
      surroundingContextSnapshot?: never;
    }
  | {
      anchor: CommentAnchor;
      filePath: string;
      kind: "comment";
      selectedTextSnapshot: string;
      sourceCommentId: string;
      sourceRange: SourceRange;
      surroundingContextSnapshot: string;
    };

export type ChatRunState = "idle" | "starting" | "streaming" | "error";

export interface WorkspaceChatThread {
  activeLlmThreadId: string | null;
  activeRunId: string | null;
  /** The persisted conversation this thread maps to (the `conversations`
   * row). Null until the first send / load creates one. */
  conversationId: string | null;
  contextItems: WorkspaceContextItem[];
  messages: WorkspaceChatMessage[];
  preparedCommand: string | null;
  prompt: string;
  runError: string | null;
  runState: ChatRunState;
}

export interface WorkspaceChatMessage {
  activity: string | null;
  /** The *answer* shown in the bubble. For bob this is fed only by the
   * `attempt_completion` result; narration goes to `notices`/`status`. */
  content: string;
  id: string;
  llmThreadId?: string;
  role: "assistant" | "user";
  runId?: string;
  streaming?: boolean;
  suggestions?: WorkspaceDocumentSuggestion[];
  /** Harness session id (bob's `init`). Trace-only. */
  sessionId?: string;
  /** The agent's process as an *ordered* timeline — reasoning, narration,
   * and tool calls interleaved in arrival order (not grouped by kind).
   * Drives both the agent-trace panel and the live status indicator (the
   * last entry). The transient status is derived from this, never stored;
   * the answer is `content`, fed only by `attempt_completion`. */
  trace?: TraceEntry[];
  /** Terminal usage stats (token / coin counts), shown as a float beside
   * the trace toggle. */
  stats?: WorkspaceRunStats;
}

/** One step in a message's agent trace, in arrival order. Consecutive
 * `thinking`/`notice` deltas are concatenated into the same entry; tool
 * calls are discrete and keyed by id. */
export type TraceEntry =
  | { kind: "thinking"; text: string }
  | { kind: "notice"; text: string }
  | { kind: "tool"; tool: WorkspaceToolCall };

/** A tool call in the trace; its status flips running → done/error as
 * ToolStart/ToolEnd events arrive. `input` is the call's arguments and
 * `output` the result, paired in the trace. */
export interface WorkspaceToolCall {
  id: string;
  name: string;
  status: "running" | "done" | "error";
  input?: string;
  output?: string;
}

/** Terminal run stats from the harness (bob's `result.stats`). */
export interface WorkspaceRunStats {
  totalTokens?: number;
  toolCalls?: number;
  coins?: number;
}

/**
 * Sum the per-message usage stats across a whole thread, for the header
 * total. Messages without stats (user turns, in-flight assistant turns)
 * contribute nothing.
 */
export function sumChatThreadStats(thread: WorkspaceChatThread): WorkspaceRunStats {
  let totalTokens = 0;
  let coins = 0;
  for (const message of thread.messages) {
    totalTokens += message.stats?.totalTokens ?? 0;
    coins += message.stats?.coins ?? 0;
  }
  return { totalTokens, coins };
}

export type WorkspaceSuggestionStatus = "pending" | "accepted" | "rejected" | "stale";

export interface WorkspaceDocumentSuggestion {
  createdAt: number;
  filePath: string;
  id: string;
  originalText: string;
  range: SourceRange;
  replacement: string;
  status: WorkspaceSuggestionStatus;
  statusMessage: string | null;
  title: string;
  updatedAt: number;
}

export interface WorkspaceSuggestionDraft {
  filePath: string;
  originalText: string;
  range: SourceRange;
  replacement: string;
  title: string;
}

export interface BobSuggestedEditInput {
  filePath: string;
  range: SourceRange;
  replacement: string;
  title: string | null;
}

export interface WorkspaceSuggestionPreparation {
  drafts: WorkspaceSuggestionDraft[];
  rejectedCount: number;
}

export interface WorkspaceFileEntry {
  lastModifiedMs: number;
  relativePath: string;
  sizeBytes: number;
}

export interface WorkspaceFileBuffer {
  conflict: boolean;
  content: string;
  dirty: boolean;
  lastModifiedMs: number;
  pendingChanges: DocumentTextChange[];
}

export type WorkspaceScanState = "idle" | "loading" | "ready" | "failed";
export type WorkspaceIndexState = "idle" | "indexing" | "ready" | "failed";

/** A non-file tab in the editor pane strip (Settings today; terminal /
 *  browser are the obvious future kinds the host already switches on). */
export type WorkspacePaneKind = "settings" | "terminal" | "browser";

export interface WorkspacePane {
  id: string;
  kind: WorkspacePaneKind;
  title: string;
}

export interface BobWorkspace {
  activeFilePath: string;
  /** When set, a non-file pane (by id) is the active tab instead of a file. */
  activePaneId: string | null;
  chatThread: WorkspaceChatThread;
  comments: WorkspaceCommentThread[];
  fileContents: Record<string, WorkspaceFileBuffer>;
  files: WorkspaceFileEntry[];
  id: string;
  indexError: string | null;
  indexSnapshot: WorkspaceIndexSnapshot | null;
  indexState: WorkspaceIndexState;
  lastOpenedAt?: number;
  lastSavedAt: Date | null;
  name: string;
  openFilePaths: string[];
  /** Open non-file panes (Settings, etc.) shown in the tab strip. */
  openPanes: WorkspacePane[];
  path: string;
  scanError: string | null;
  scanState: WorkspaceScanState;
}

export interface WorkspaceTabs {
  activeFilePath: string;
  openFilePaths: string[];
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  path: string;
  tabs?: WorkspaceTabs;
  lastOpenedAt?: number;
}

export interface OnboardingState {
  completedAt?: number;
}

export interface WorkspaceListResult {
  activeWorkspaceId: string | null;
  onboarding: OnboardingState;
  workspaces: WorkspaceRecord[];
}

export interface WorkspaceFsEvent {
  kind: "created" | "modified" | "removed";
  lastModifiedMs: number | null;
  relativePath: string;
}

export type FsEventEffect =
  | { type: "reloadFile"; relativePath: string }
  | { type: "rescan" }
  | { type: "noop" };

export function isSetupComplete(authStatus: BobAuthStatus, workspaces: BobWorkspace[]) {
  return authStatus.configured && workspaces.length > 0;
}

export function bobRuntimeReadiness(
  authStatus: BobAuthStatus,
  installStatus: BobInstallStatus | null,
): BobRuntimeReadiness {
  if (authStatus.errorMessage) {
    return { message: authStatus.errorMessage, ready: false };
  }
  if (!authStatus.configured) {
    return { message: "Connect your Bob API key.", ready: false };
  }
  if (!installStatus) {
    return { message: "Checking Bob CLI.", ready: false };
  }
  if (installStatus.requiresDesktopRuntime) {
    return { message: "Open the desktop app to run Bob.", ready: false };
  }
  if (!installStatus.installed) {
    return { message: installStatus.errorMessage ?? "Bob CLI not found.", ready: false };
  }
  return { message: null, ready: true };
}

export function createWorkspaceFromPath(path: string): BobWorkspace {
  const normalizedPath = normalizeWorkspacePath(path);

  return {
    activeFilePath: "",
    activePaneId: null,
    chatThread: {
      activeLlmThreadId: null,
      activeRunId: null,
      conversationId: null,
      contextItems: [],
      messages: [],
      preparedCommand: null,
      prompt: "",
      runError: null,
      runState: "idle",
    },
    comments: [],
    fileContents: {},
    files: [],
    id: createWorkspaceId(normalizedPath),
    indexError: null,
    indexSnapshot: null,
    indexState: "idle",
    lastSavedAt: null,
    name: workspaceNameFromPath(normalizedPath),
    openFilePaths: [],
    openPanes: [],
    path: normalizedPath,
    scanError: null,
    scanState: "idle",
  };
}

export function createWorkspaceFromRecord(record: WorkspaceRecord): BobWorkspace {
  const workspace = createWorkspaceFromPath(record.path);
  const restoredOpen = record.tabs?.openFilePaths ?? [];
  const restoredActive = record.tabs?.activeFilePath ?? "";

  return {
    ...workspace,
    activeFilePath: restoredActive,
    chatThread: setCurrentTabContext(workspace.chatThread, record.id, restoredActive),
    id: record.id,
    lastOpenedAt: record.lastOpenedAt,
    name: record.name,
    openFilePaths: restoredOpen,
  };
}

export function hydrateWorkspaceRecords(
  existingWorkspaces: BobWorkspace[],
  records: WorkspaceRecord[],
) {
  return records.map((record) => {
    const existingWorkspace = existingWorkspaces.find((workspace) => workspace.id === record.id);
    if (!existingWorkspace) {
      return createWorkspaceFromRecord(record);
    }
    if (existingWorkspace.lastOpenedAt === record.lastOpenedAt) {
      return existingWorkspace;
    }
    return { ...existingWorkspace, lastOpenedAt: record.lastOpenedAt };
  });
}

export function setCurrentTabContext(
  chatThread: WorkspaceChatThread,
  workspaceId: string,
  filePath: string,
): WorkspaceChatThread {
  if (!filePath) {
    return {
      ...chatThread,
      contextItems: [],
    };
  }

  return {
    ...chatThread,
    contextItems: [
      {
        id: createContextId(workspaceId, filePath),
        kind: "file",
        label: filePath,
        path: filePath,
        workspaceId,
      },
    ],
  };
}

export function openWorkspaceFile(workspace: BobWorkspace, filePath: string): BobWorkspace {
  const openFilePaths = workspace.openFilePaths.includes(filePath)
    ? workspace.openFilePaths
    : [...workspace.openFilePaths, filePath];

  return {
    ...workspace,
    // Activating a file clears any active non-file pane (Settings, etc.):
    // the editor takes over the pane region.
    activeFilePath: filePath,
    activePaneId: null,
    chatThread: setCurrentTabContext(workspace.chatThread, workspace.id, filePath),
    openFilePaths,
  };
}

/** Open (or focus) a non-file pane and make it the active tab. */
export function openWorkspacePane(workspace: BobWorkspace, pane: WorkspacePane): BobWorkspace {
  const openPanes = workspace.openPanes.some((existing) => existing.id === pane.id)
    ? workspace.openPanes
    : [...workspace.openPanes, pane];
  return { ...workspace, activePaneId: pane.id, openPanes };
}

/** Close a non-file pane; if it was active, fall back to the active file. */
export function closeWorkspacePane(workspace: BobWorkspace, paneId: string): BobWorkspace {
  const openPanes = workspace.openPanes.filter((pane) => pane.id !== paneId);
  const activePaneId = workspace.activePaneId === paneId ? null : workspace.activePaneId;
  return { ...workspace, activePaneId, openPanes };
}

export function closeWorkspaceFileTab(workspace: BobWorkspace, filePath: string): BobWorkspace {
  const closingIndex = workspace.openFilePaths.indexOf(filePath);
  if (closingIndex === -1) {
    return workspace;
  }

  const openFilePaths = workspace.openFilePaths.filter((path) => path !== filePath);
  const activeFilePath =
    workspace.activeFilePath === filePath
      ? openFilePaths[Math.min(closingIndex, openFilePaths.length - 1)] ?? ""
      : workspace.activeFilePath;

  const remainingFileContents = { ...workspace.fileContents };
  delete remainingFileContents[filePath];

  return {
    ...workspace,
    activeFilePath,
    chatThread: setCurrentTabContext(workspace.chatThread, workspace.id, activeFilePath),
    fileContents: remainingFileContents,
    openFilePaths,
  };
}

export function applyScanResult(
  workspace: BobWorkspace,
  entries: WorkspaceFileEntry[],
): BobWorkspace {
  const knownPaths = new Set(entries.map((entry) => entry.relativePath));
  const openFilePaths = workspace.openFilePaths.filter((path) => knownPaths.has(path));
  const fileContents: Record<string, WorkspaceFileBuffer> = {};
  for (const [path, buffer] of Object.entries(workspace.fileContents)) {
    if (knownPaths.has(path)) {
      fileContents[path] = buffer;
    }
  }

  let activeFilePath = workspace.activeFilePath;
  if (activeFilePath && !knownPaths.has(activeFilePath)) {
    activeFilePath = openFilePaths[0] ?? "";
  }

  return {
    ...workspace,
    activeFilePath,
    chatThread: setCurrentTabContext(workspace.chatThread, workspace.id, activeFilePath),
    comments: workspace.comments.filter((comment) => knownPaths.has(comment.filePath)),
    fileContents,
    files: [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    openFilePaths,
    scanError: null,
    scanState: "ready",
  };
}

export function applyFileBuffer(
  workspace: BobWorkspace,
  relativePath: string,
  buffer: { content: string; lastModifiedMs: number },
): BobWorkspace {
  return {
    ...workspace,
    fileContents: {
      ...workspace.fileContents,
      [relativePath]: {
        conflict: false,
        content: buffer.content,
        dirty: false,
        lastModifiedMs: buffer.lastModifiedMs,
        pendingChanges: [],
      },
    },
  };
}

export function markWorkspaceIndexing(workspace: BobWorkspace): BobWorkspace {
  return {
    ...workspace,
    indexError: null,
    indexState: "indexing",
  };
}

export function applyWorkspaceIndexSnapshot(
  workspace: BobWorkspace,
  snapshot: WorkspaceIndexSnapshot,
): BobWorkspace {
  if (snapshot.workspaceId !== workspace.id) {
    return workspace;
  }
  return {
    ...workspace,
    indexError: null,
    indexSnapshot: snapshot,
    indexState: "ready",
  };
}

export function markWorkspaceIndexFailed(
  workspace: BobWorkspace,
  errorMessage: string,
): BobWorkspace {
  return {
    ...workspace,
    indexError: errorMessage,
    indexState: "failed",
  };
}

export function commentsForFile(workspace: BobWorkspace, filePath: string) {
  return workspace.comments.filter(
    (comment) => comment.filePath === filePath && comment.status === "open",
  );
}

export function addWorkspaceComment(
  workspace: BobWorkspace,
  input: {
    body: string;
    filePath: string;
    range: SourceRange;
    selectedText: string;
    timestamp: number;
  },
): BobWorkspace {
  const buffer = workspace.fileContents[input.filePath];
  if (!buffer || !input.body.trim() || input.range.start >= input.range.end) {
    return workspace;
  }

  const comment = createCommentThread({
    body: input.body,
    filePath: input.filePath,
    fullText: buffer.content,
    id: `comment-${input.timestamp}-${workspace.comments.length + 1}`,
    range: input.range,
    selectedText: input.selectedText,
    timestamp: input.timestamp,
  });

  return {
    ...workspace,
    comments: [...workspace.comments, comment],
  };
}

export function applyWorkspaceDocumentChanges(
  workspace: BobWorkspace,
  relativePath: string,
  content: string,
  changes: DocumentTextChange[],
  timestamp: number,
): BobWorkspace {
  const next = markBufferDirty(workspace, relativePath, content, changes);
  if (next === workspace || changes.length === 0) {
    return next;
  }

  return {
    ...next,
    comments: applyDocumentChangesToComments(next.comments, relativePath, changes, timestamp),
  };
}

export function prepareWorkspaceSuggestionDrafts(
  workspace: BobWorkspace,
  edits: BobSuggestedEditInput[],
): WorkspaceSuggestionPreparation {
  const drafts: WorkspaceSuggestionDraft[] = [];
  let rejectedCount = 0;
  // One mapper per file content reused across edits targeting the same
  // buffer — a batch of suggestions from one Bob turn typically hits the
  // same document many times.
  const mappersByFilePath = new Map<string, PositionMapper>();

  for (const edit of edits) {
    const filePath = edit.filePath.trim();
    const buffer = workspace.fileContents[filePath];
    if (!buffer) {
      rejectedCount += 1;
      continue;
    }
    let mapper = mappersByFilePath.get(filePath);
    if (!mapper || mapper.text !== buffer.content) {
      mapper = new PositionMapper(buffer.content);
      mappersByFilePath.set(filePath, mapper);
    }
    const rangeIsValid =
      Number.isInteger(edit.range.start) &&
      Number.isInteger(edit.range.end) &&
      edit.range.start >= 0 &&
      edit.range.end >= edit.range.start &&
      edit.range.end <= mapper.byteLength;

    if (!rangeIsValid) {
      rejectedCount += 1;
      continue;
    }

    const originalText = mapper.sliceByByteRange(edit.range);
    if (originalText === edit.replacement) {
      rejectedCount += 1;
      continue;
    }

    drafts.push({
      filePath,
      originalText,
      range: { ...edit.range },
      replacement: edit.replacement,
      title: edit.title?.trim() || "Suggested edit",
    });
  }

  return { drafts, rejectedCount };
}

export function moveWorkspaceComments(
  workspace: BobWorkspace,
  fromFilePath: string,
  toFilePath: string,
  timestamp: number,
): BobWorkspace {
  return {
    ...workspace,
    comments: moveCommentsToFile(workspace.comments, fromFilePath, toFilePath, timestamp),
  };
}

export function setCommentChatContext(
  chatThread: WorkspaceChatThread,
  workspaceId: string,
  comment: WorkspaceCommentThread,
): WorkspaceChatThread {
  return {
    ...chatThread,
    contextItems: [
      {
        id: createContextId(workspaceId, comment.filePath),
        kind: "file",
        label: comment.filePath,
        path: comment.filePath,
        workspaceId,
      },
      {
        anchor: comment.anchor,
        commentBody: comment.body,
        filePath: comment.filePath,
        id: `${workspaceId}:${comment.id}`,
        kind: "comment",
        label: `Comment on ${comment.filePath}`,
        path: comment.filePath,
        range: comment.anchor.range,
        selectedText: comment.anchor.selectedText,
        surroundingContext: `${comment.anchor.prefix}${comment.anchor.selectedText}${comment.anchor.suffix}`,
        workspaceId,
      },
    ],
  };
}

export function createLlmContextSnapshots(
  contextItems: WorkspaceContextItem[],
): LlmContextSnapshotInput[] {
  return contextItems.map((item) => {
    if (item.kind === "file") {
      return {
        filePath: item.path,
        kind: "file",
      };
    }

    return {
      anchor: item.anchor,
      filePath: item.filePath,
      kind: "comment",
      selectedTextSnapshot: item.selectedText,
      sourceCommentId: item.id.split(":").slice(1).join(":") || item.id,
      sourceRange: item.range,
      surroundingContextSnapshot: item.surroundingContext,
    };
  });
}

export function markBufferDirty(
  workspace: BobWorkspace,
  relativePath: string,
  content: string,
  changes: DocumentTextChange[] = [],
): BobWorkspace {
  const existing = workspace.fileContents[relativePath];
  if (!existing) {
    return workspace;
  }
  const pendingChanges =
    changes.length > 0 ? [...existing.pendingChanges, ...changes] : existing.pendingChanges;
  if (
    existing.content === content &&
    existing.dirty &&
    pendingChanges === existing.pendingChanges
  ) {
    return workspace;
  }
  return {
    ...workspace,
    fileContents: {
      ...workspace.fileContents,
      [relativePath]: { ...existing, content, dirty: true, pendingChanges },
    },
  };
}

export function markBufferSaved(
  workspace: BobWorkspace,
  relativePath: string,
  lastModifiedMs: number,
): BobWorkspace {
  const existing = workspace.fileContents[relativePath];
  if (!existing) {
    return workspace;
  }
  const files = workspace.files.map((entry) =>
    entry.relativePath === relativePath
      ? { ...entry, lastModifiedMs, sizeBytes: existing.content.length }
      : entry,
  );
  return {
    ...workspace,
    files,
    fileContents: {
      ...workspace.fileContents,
      [relativePath]: {
        ...existing,
        conflict: false,
        dirty: false,
        lastModifiedMs,
        pendingChanges: [],
      },
    },
    lastSavedAt: new Date(),
  };
}

export function markBufferConflict(
  workspace: BobWorkspace,
  relativePath: string,
): BobWorkspace {
  const existing = workspace.fileContents[relativePath];
  if (!existing) {
    return workspace;
  }
  return {
    ...workspace,
    fileContents: {
      ...workspace.fileContents,
      [relativePath]: { ...existing, conflict: true },
    },
  };
}

export function dismissBufferConflict(
  workspace: BobWorkspace,
  relativePath: string,
): BobWorkspace {
  const existing = workspace.fileContents[relativePath];
  if (!existing) {
    return workspace;
  }
  return {
    ...workspace,
    fileContents: {
      ...workspace.fileContents,
      [relativePath]: { ...existing, conflict: false },
    },
  };
}

export function applyFsEvent(
  workspace: BobWorkspace,
  event: WorkspaceFsEvent,
): { workspace: BobWorkspace; effect: FsEventEffect } {
  if (event.kind === "created" || event.kind === "removed") {
    return { workspace, effect: { type: "rescan" } };
  }

  const buffer = workspace.fileContents[event.relativePath];
  const updatedFiles = event.lastModifiedMs
    ? workspace.files.map((entry) =>
        entry.relativePath === event.relativePath
          ? { ...entry, lastModifiedMs: event.lastModifiedMs as number }
          : entry,
      )
    : workspace.files;

  if (!buffer) {
    return {
      workspace: { ...workspace, files: updatedFiles },
      effect: { type: "noop" },
    };
  }

  if (event.lastModifiedMs != null && event.lastModifiedMs <= buffer.lastModifiedMs) {
    return {
      workspace: { ...workspace, files: updatedFiles },
      effect: { type: "noop" },
    };
  }

  if (buffer.dirty) {
    return {
      workspace: markBufferConflict({ ...workspace, files: updatedFiles }, event.relativePath),
      effect: { type: "noop" },
    };
  }

  return {
    workspace: { ...workspace, files: updatedFiles },
    effect: { type: "reloadFile", relativePath: event.relativePath },
  };
}

export function appendUserChatMessage(
  chatThread: WorkspaceChatThread,
  userContent: string,
  preparedCommand: string | null,
  llmThreadId: string | null = null,
): WorkspaceChatThread {
  const trimmedUserContent = userContent.trim();
  if (!trimmedUserContent) {
    return chatThread;
  }

  const nextMessageNumber = chatThread.messages.length + 1;

  return {
    ...chatThread,
    messages: [
      ...chatThread.messages,
      {
        activity: null,
        content: trimmedUserContent,
        id: `message-${nextMessageNumber}`,
        ...(llmThreadId ? { llmThreadId } : {}),
        role: "user",
      },
    ],
    preparedCommand,
    prompt: "",
  };
}

export function startBobRun(
  chatThread: WorkspaceChatThread,
  runId: string,
  llmThreadId: string | null = null,
): WorkspaceChatThread {
  return {
    ...chatThread,
    activeLlmThreadId: llmThreadId,
    activeRunId: runId,
    runError: null,
    runState: "starting",
  };
}

export function markBobRunStreaming(
  chatThread: WorkspaceChatThread,
  runId: string,
): WorkspaceChatThread {
  if (chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const placeholder: WorkspaceChatMessage = {
    activity: null,
    content: "",
    id: `message-${chatThread.messages.length + 1}`,
    ...(chatThread.activeLlmThreadId ? { llmThreadId: chatThread.activeLlmThreadId } : {}),
    role: "assistant",
    runId,
    streaming: true,
  };
  return {
    ...chatThread,
    messages: [...chatThread.messages, placeholder],
    runState: "streaming",
  };
}

function ensureAssistantMessage(
  chatThread: WorkspaceChatThread,
  runId: string,
): { thread: WorkspaceChatThread; messageId: string } {
  const last = chatThread.messages[chatThread.messages.length - 1];
  if (last && last.role === "assistant" && last.runId === runId) {
    return { thread: chatThread, messageId: last.id };
  }
  const placeholder: WorkspaceChatMessage = {
    activity: null,
    content: "",
    id: `message-${chatThread.messages.length + 1}`,
    ...(chatThread.activeLlmThreadId ? { llmThreadId: chatThread.activeLlmThreadId } : {}),
    role: "assistant",
    runId,
    streaming: true,
  };
  return {
    thread: { ...chatThread, messages: [...chatThread.messages, placeholder] },
    messageId: placeholder.id,
  };
}

export function appendAssistantText(
  chatThread: WorkspaceChatThread,
  runId: string,
  text: string,
): WorkspaceChatThread {
  if (!text || chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const { thread, messageId } = ensureAssistantMessage(chatThread, runId);
  return {
    ...thread,
    messages: thread.messages.map((message) =>
      message.id === messageId ? { ...message, content: message.content + text } : message,
    ),
  };
}

/**
 * Append a chunk of model reasoning to the active assistant message's
 * trace. Consecutive thinking deltas concatenate into the same `thinking`
 * entry; a tool/notice in between starts a fresh one. A no-op when `runId`
 * isn't the active run.
 */
export function appendAssistantThinking(
  chatThread: WorkspaceChatThread,
  runId: string,
  delta: string,
): WorkspaceChatThread {
  return appendTraceText(chatThread, runId, "thinking", delta);
}

/**
 * Append a chunk of agent *narration* to the active assistant message's
 * trace (the intermediate "what I'm doing" text — never the answer).
 * Consecutive notice deltas concatenate into the same `notice` entry; the
 * last entry drives the live status indicator.
 */
export function appendAssistantNotice(
  chatThread: WorkspaceChatThread,
  runId: string,
  delta: string,
): WorkspaceChatThread {
  return appendTraceText(chatThread, runId, "notice", delta);
}

/**
 * Shared body for the streaming text traces (`thinking` / `notice`):
 * concatenate the delta into the trailing entry when it is the same kind,
 * else push a new entry, preserving arrival order.
 */
function appendTraceText(
  chatThread: WorkspaceChatThread,
  runId: string,
  kind: "thinking" | "notice",
  delta: string,
): WorkspaceChatThread {
  if (!delta || chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const { thread, messageId } = ensureAssistantMessage(chatThread, runId);
  return {
    ...thread,
    messages: thread.messages.map((message) => {
      if (message.id !== messageId) {
        return message;
      }
      const trace = message.trace ?? [];
      const last = trace[trace.length - 1];
      // Concatenate into the trailing entry when it's the same streaming
      // kind; otherwise start a fresh entry (preserving arrival order).
      const prevText = last && last.kind === kind && "text" in last ? last.text : null;
      if (prevText !== null) {
        const merged = makeTextEntry(kind, prevText + delta);
        return { ...message, trace: [...trace.slice(0, -1), merged] };
      }
      // Don't start a brand-new entry for a whitespace-only delta: bob
      // emits a "\n\n" message after a tool, which would otherwise become
      // a blank trace step / blank status line. Real text that merely
      // *begins* with whitespace still concatenates (handled above).
      if (!delta.trim()) {
        return message;
      }
      return { ...message, trace: [...trace, makeTextEntry(kind, delta)] };
    }),
  };
}

/** Build a `thinking`/`notice` trace entry from a literal kind (keeps the
 * discriminated union sound — a `"thinking" | "notice"` variable can't be
 * assigned to `TraceEntry` directly). */
function makeTextEntry(kind: "thinking" | "notice", text: string): TraceEntry {
  return kind === "thinking" ? { kind: "thinking", text } : { kind: "notice", text };
}

/** Record the harness session id on the active assistant message (trace). */
export function setAssistantSession(
  chatThread: WorkspaceChatThread,
  runId: string,
  sessionId: string,
): WorkspaceChatThread {
  if (!sessionId || chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const { thread, messageId } = ensureAssistantMessage(chatThread, runId);
  return {
    ...thread,
    messages: thread.messages.map((item) =>
      item.id === messageId ? { ...item, sessionId } : item,
    ),
  };
}

/** Record terminal usage stats on the active assistant message. */
export function setAssistantStats(
  chatThread: WorkspaceChatThread,
  runId: string,
  stats: WorkspaceRunStats,
): WorkspaceChatThread {
  if (chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const { thread, messageId } = ensureAssistantMessage(chatThread, runId);
  return {
    ...thread,
    messages: thread.messages.map((item) =>
      item.id === messageId ? { ...item, stats } : item,
    ),
  };
}

/**
 * Append a running tool call to the active assistant message's trace
 * (deduped by id), capturing its `input`. Pushed in arrival order so it
 * interleaves with reasoning/narration. A no-op when `runId` isn't the
 * active run.
 */
export function startAssistantToolCall(
  chatThread: WorkspaceChatThread,
  runId: string,
  toolCallId: string,
  name: string,
  input?: string | null,
): WorkspaceChatThread {
  if (chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const { thread, messageId } = ensureAssistantMessage(chatThread, runId);
  return {
    ...thread,
    messages: thread.messages.map((message) => {
      if (message.id !== messageId) {
        return message;
      }
      const trace = message.trace ?? [];
      if (trace.some((entry) => entry.kind === "tool" && entry.tool.id === toolCallId)) {
        return message;
      }
      const tool: WorkspaceToolCall = {
        id: toolCallId,
        name,
        status: "running",
        ...(input ? { input } : {}),
      };
      return { ...message, trace: [...trace, { kind: "tool", tool }] };
    }),
  };
}

/**
 * Flip a tool call's status to done/error (matched by id) in the active
 * assistant message's trace, recording its `output`.
 */
export function endAssistantToolCall(
  chatThread: WorkspaceChatThread,
  runId: string,
  toolCallId: string,
  ok: boolean,
  output?: string | null,
): WorkspaceChatThread {
  if (chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const { thread, messageId } = ensureAssistantMessage(chatThread, runId);
  return {
    ...thread,
    messages: thread.messages.map((message) => {
      if (message.id !== messageId || !message.trace) {
        return message;
      }
      return {
        ...message,
        trace: message.trace.map((entry) =>
          entry.kind === "tool" && entry.tool.id === toolCallId
            ? {
                kind: "tool",
                tool: {
                  ...entry.tool,
                  status: ok ? ("done" as const) : ("error" as const),
                  ...(output ? { output } : {}),
                },
              }
            : entry,
        ),
      };
    }),
  };
}

export function appendAssistantSuggestions(
  chatThread: WorkspaceChatThread,
  runId: string,
  drafts: WorkspaceSuggestionDraft[],
  timestamp: number,
): WorkspaceChatThread {
  if (drafts.length === 0 || chatThread.activeRunId !== runId) {
    return chatThread;
  }

  const { thread, messageId } = ensureAssistantMessage(chatThread, runId);
  return {
    ...thread,
    messages: thread.messages.map((message) => {
      if (message.id !== messageId) {
        return message;
      }
      const existingSuggestions = message.suggestions ?? [];
      const nextSuggestions = drafts.map((draft, index) => ({
        createdAt: timestamp,
        filePath: draft.filePath,
        id: `${messageId}-suggestion-${existingSuggestions.length + index + 1}`,
        originalText: draft.originalText,
        range: { ...draft.range },
        replacement: draft.replacement,
        status: "pending" as const,
        statusMessage: null,
        title: draft.title,
        updatedAt: timestamp,
      }));
      return {
        ...message,
        activity: `${nextSuggestions.length} suggested edit${nextSuggestions.length === 1 ? "" : "s"}`,
        suggestions: [...existingSuggestions, ...nextSuggestions],
      };
    }),
  };
}

export function acceptWorkspaceSuggestion(
  workspace: BobWorkspace,
  suggestionId: string,
  timestamp: number,
): BobWorkspace {
  const suggestion = findSuggestion(workspace.chatThread, suggestionId);
  if (!suggestion || suggestion.status !== "pending") {
    return workspace;
  }

  const buffer = workspace.fileContents[suggestion.filePath];
  if (!buffer) {
    return updateWorkspaceSuggestion(workspace, suggestionId, {
      status: "stale",
      statusMessage: "File is not loaded.",
      updatedAt: timestamp,
    });
  }

  const mapper = new PositionMapper(buffer.content);
  const currentText = mapper.sliceByByteRange(suggestion.range);
  if (currentText !== suggestion.originalText) {
    return updateWorkspaceSuggestion(workspace, suggestionId, {
      status: "stale",
      statusMessage: "Source changed since Bob suggested this edit.",
      updatedAt: timestamp,
    });
  }

  const content = replaceByByteRange(mapper, suggestion.range, suggestion.replacement);
  const changed = applyWorkspaceDocumentChanges(
    workspace,
    suggestion.filePath,
    content,
    [{ range: suggestion.range, text: suggestion.replacement }],
    timestamp,
  );

  return updateWorkspaceSuggestion(changed, suggestionId, {
    status: "accepted",
    statusMessage: null,
    updatedAt: timestamp,
  });
}

export function rejectWorkspaceSuggestion(
  workspace: BobWorkspace,
  suggestionId: string,
  timestamp: number,
): BobWorkspace {
  const suggestion = findSuggestion(workspace.chatThread, suggestionId);
  if (!suggestion || suggestion.status !== "pending") {
    return workspace;
  }

  return updateWorkspaceSuggestion(workspace, suggestionId, {
    status: "rejected",
    statusMessage: null,
    updatedAt: timestamp,
  });
}

export function setAssistantActivity(
  chatThread: WorkspaceChatThread,
  runId: string,
  activity: string | null,
): WorkspaceChatThread {
  if (chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const { thread, messageId } = ensureAssistantMessage(chatThread, runId);
  return {
    ...thread,
    messages: thread.messages.map((message) =>
      message.id === messageId ? { ...message, activity } : message,
    ),
  };
}

export function assistantMessageContentForRun(chatThread: WorkspaceChatThread, runId: string) {
  const message = [...chatThread.messages]
    .reverse()
    .find((item) => item.role === "assistant" && item.runId === runId);
  return message?.content.trim() ?? "";
}

export interface FinalizeBobRunOptions {
  cancelled?: boolean;
  errorMessage?: string | null;
  exitCode?: number | null;
}

export function finalizeBobRun(
  chatThread: WorkspaceChatThread,
  runId: string,
  options: FinalizeBobRunOptions = {},
): WorkspaceChatThread {
  if (chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const { cancelled, errorMessage, exitCode } = options;
  const hasFailure =
    Boolean(errorMessage) ||
    (typeof exitCode === "number" && exitCode !== 0 && !cancelled);

  const messages = chatThread.messages.map((message) => {
    if (message.runId !== runId || message.role !== "assistant") {
      return message;
    }
    let activity = message.activity;
    if (cancelled) {
      activity = "Cancelled";
    } else if (errorMessage) {
      activity = errorMessage;
    } else if (typeof exitCode === "number" && exitCode !== 0) {
      activity = `The assistant exited with code ${exitCode}`;
    } else {
      activity = null;
    }
    // The run is over: clearing `streaming` retires the live status
    // indicator (which is derived from the trace + streaming). The trace
    // itself is preserved.
    return { ...message, streaming: false, activity };
  });

  return {
    ...chatThread,
    activeLlmThreadId: null,
    activeRunId: null,
    messages,
    runError: hasFailure ? errorMessage ?? `The assistant exited with code ${exitCode ?? "?"}` : null,
    runState: hasFailure ? "error" : "idle",
  };
}

/**
 * Serialize a thread's messages for persistence — `<role, content, trace,
 * stats>` per message. `trace`/`stats` are JSON-stringified (the trace is
 * already the consolidated `TraceEntry[]` on the message; no transform).
 * Streaming / placeholder messages with no content are skipped — only
 * settled turns are persisted.
 */
export function serializeChatMessages(
  thread: WorkspaceChatThread,
): ConversationMessageRecord[] {
  return thread.messages
    .filter((message) => message.content.trim())
    .map((message, index) => ({
      messageId: message.id || `message-${index + 1}`,
      role: message.role,
      content: message.content,
      ...(message.trace?.length ? { traceJson: JSON.stringify(message.trace) } : {}),
      ...(message.stats ? { statsJson: JSON.stringify(message.stats) } : {}),
      createdAt: index,
    }));
}

/**
 * Rebuild a chat thread from a persisted conversation snapshot, parsing
 * `traceJson`/`statsJson` back into `trace`/`stats` so a restored
 * assistant reply renders identically to live (bubble + "Show work" trace
 * + stats float). `contextItems` is preserved from the current thread
 * (the open-file context is live state, not persisted here).
 */
export function hydrateChatThread(
  thread: WorkspaceChatThread,
  snapshot: ConversationSnapshot,
): WorkspaceChatThread {
  const messages: WorkspaceChatMessage[] = snapshot.messages.map((record) => ({
    activity: null,
    content: record.content,
    id: record.messageId,
    role: record.role,
    ...(record.traceJson ? { trace: safeParseJson<TraceEntry[]>(record.traceJson) } : {}),
    ...(record.statsJson ? { stats: safeParseJson<WorkspaceRunStats>(record.statsJson) } : {}),
  }));
  return {
    ...thread,
    conversationId: snapshot.conversationId,
    messages,
    runError: null,
    runState: "idle",
  };
}

/**
 * Clear a thread for "New chat": drop messages + run state, keep the live
 * `contextItems` (the open file stays as context). `conversationId` is
 * reset by the caller to the freshly-created id.
 */
export function resetChatThread(thread: WorkspaceChatThread): WorkspaceChatThread {
  return {
    ...thread,
    activeLlmThreadId: null,
    activeRunId: null,
    conversationId: null,
    messages: [],
    preparedCommand: null,
    prompt: "",
    runError: null,
    runState: "idle",
  };
}

/** Parse persisted JSON, returning undefined on malformed data rather
 * than throwing — a corrupt row degrades to "no trace/stats", not a
 * crash that loses the whole conversation. */
function safeParseJson<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

// NOTE: bob's stream-json parsing used to live here
// (`parseBobStreamLine` + helpers). It moved to Rust as
// `compose_core::events::parse_bob_line` / `normalize_bob_event`,
// which emit the normalized `RunEvent` stream every harness shares.
// The front-end now consumes already-decoded events (see
// `handleHarnessRunEvent` in `workspaceStore.ts`) and no longer parses a
// harness wire format. `BobSuggestedEditInput` stays — it's the
// shape `prepareWorkspaceSuggestionDrafts` consumes.

function findSuggestion(
  chatThread: WorkspaceChatThread,
  suggestionId: string,
): WorkspaceDocumentSuggestion | null {
  for (const message of chatThread.messages) {
    const suggestion = message.suggestions?.find((item) => item.id === suggestionId);
    if (suggestion) {
      return suggestion;
    }
  }
  return null;
}

function updateWorkspaceSuggestion(
  workspace: BobWorkspace,
  suggestionId: string,
  updates: Pick<WorkspaceDocumentSuggestion, "status" | "statusMessage" | "updatedAt">,
): BobWorkspace {
  return {
    ...workspace,
    chatThread: {
      ...workspace.chatThread,
      messages: workspace.chatThread.messages.map((message) => {
        if (!message.suggestions?.some((suggestion) => suggestion.id === suggestionId)) {
          return message;
        }
        return {
          ...message,
          suggestions: message.suggestions.map((suggestion) =>
            suggestion.id === suggestionId ? { ...suggestion, ...updates } : suggestion,
          ),
        };
      }),
    },
  };
}

function replaceByByteRange(mapper: PositionMapper, range: SourceRange, replacement: string) {
  const start = mapper.byteToCodeUnit(range.start);
  const end = mapper.byteToCodeUnit(range.end);
  return `${mapper.text.slice(0, start)}${replacement}${mapper.text.slice(end)}`;
}

/**
 * How many *prior* turns of the conversation to replay into the prompt
 * for continuity. Caps prompt growth on a long conversation (oldest
 * turns drop first). A "turn" here is a single prior message (user or
 * assistant), so ~12 messages ≈ the last 6 exchanges.
 */
export const CONVERSATION_REPLAY_LIMIT = 12;

/**
 * Build the harness prompt: the prior-conversation transcript (for
 * continuity), then the open-file / comment context, then the new
 * prompt. The transcript is harness-neutral — it's just text every
 * harness receives, so bob / claude / codex all "remember" the
 * conversation without any native resume API.
 *
 * Only `<role, content>` is replayed — the answer and the user's words,
 * never the agent trace (that is display history, not model input). The
 * replay is capped at `CONVERSATION_REPLAY_LIMIT` most-recent prior
 * messages so a long thread can't blow the prompt size.
 */
export function createPromptWithContext(
  prompt: string,
  contextItems: WorkspaceContextItem[],
  priorMessages: WorkspaceChatMessage[] = [],
) {
  const trimmedPrompt = prompt.trim();

  const transcript = buildConversationTranscript(priorMessages);

  const fileContext = contextItems
    .filter((item): item is WorkspaceFileContextItem => item.kind === "file")
    .map((item) => `- ${item.path}`)
    .join("\n");
  const commentContext = contextItems
    .filter((item): item is WorkspaceCommentContextItem => item.kind === "comment")
    .map(
      (item) =>
        [
          `File: ${item.filePath}`,
          `Byte range: ${item.range.start}-${item.range.end}`,
          `Selected text: ${item.selectedText}`,
          item.commentBody ? `Comment: ${item.commentBody}` : null,
          `Surrounding context: ${item.surroundingContext}`,
        ]
          .filter(Boolean)
          .join("\n"),
    )
    .join("\n\n");

  const blocks = [
    transcript ? `Conversation so far:\n${transcript}` : null,
    fileContext ? `Context files:\n${fileContext}` : null,
    commentContext ? `Comment context:\n${commentContext}` : null,
  ].filter(Boolean);

  if (blocks.length === 0) {
    return trimmedPrompt;
  }
  return `${blocks.join("\n\n")}\n\n${trimmedPrompt}`;
}

/** A compact `User: … / Assistant: …` transcript of the most-recent
 * prior turns, content only (trace excluded), capped to the replay
 * limit. Empty string when there's nothing to replay. */
function buildConversationTranscript(priorMessages: WorkspaceChatMessage[]): string {
  const replayable = priorMessages.filter((message) => message.content.trim());
  const recent = replayable.slice(-CONVERSATION_REPLAY_LIMIT);
  if (recent.length === 0) {
    return "";
  }
  return recent
    .map((message) => {
      const speaker = message.role === "user" ? "User" : "Assistant";
      return `${speaker}: ${message.content.trim()}`;
    })
    .join("\n\n");
}

export function createWorkspaceId(path: string) {
  const normalizedPath = normalizeWorkspacePath(path);
  let hash = 0x811c9dc5;

  for (const character of normalizedPath) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }

  return `workspace-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function normalizeWorkspacePath(path: string) {
  const normalizedPath = path.trim().replace(/\/+$/, "");
  if (!normalizedPath) {
    throw new Error("workspace path cannot be blank");
  }

  return normalizedPath;
}

function workspaceNameFromPath(path: string) {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function createContextId(workspaceId: string, filePath: string) {
  return `${workspaceId}:${filePath}`;
}
