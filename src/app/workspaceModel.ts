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
import type { HarnessReadiness, ToolKind } from "../lib/ipc/harnessClient";
import type {
  ConversationMessageRecord,
  ConversationSnapshot,
} from "../lib/ipc/conversationsClient";

export type {
  DocumentTextChange,
  SourceRange,
  WorkspaceCommentThread,
} from "../features/comments/commentModel";

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

/**
 * A commented/highlighted passage a user message was created from — rendered as
 * a chip (file + line:col + excerpt + note) instead of raw quoted text.
 */
export interface ChatExcerptRef {
  filePath: string;
  /** 1-based line of the highlight start in the markdown source. */
  line: number;
  /** 1-based column of the highlight start. */
  column: number;
  /** The highlighted text. */
  text: string;
  /** The user's note on it. */
  note: string;
}

export interface WorkspaceChatMessage {
  activity: string | null;
  /** The *answer* shown in the bubble. For bob this is fed only by the
   * `attempt_completion` result; narration goes to `notices`/`status`. */
  content: string;
  /** Set when this user message was made from a commented passage — renders as
   * a chip (file + line:col + excerpt + note) instead of the raw quoted text. */
  excerpt?: ChatExcerptRef;
  id: string;
  llmThreadId?: string;
  role: "assistant" | "user";
  runId?: string;
  streaming?: boolean;
  /** This reply's run never finished — the app quit/crashed mid-stream, so it
   * was loaded still marked streaming. Renders a "Response interrupted" note
   * with a Retry. Set on load (see `hydrateChatThread`), never while live. */
  interrupted?: boolean;
  suggestions?: WorkspaceDocumentSuggestion[];
  /** File changes a `snapshot`-mode run already applied to disk, shown as an
   * informational diff. Transient UI state — not persisted (see
   * `serializeChatMessages`). */
  appliedChanges?: WorkspaceAppliedChange[];
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
  /** Neutral behaviour class from the harness (read / write / edit / …),
   * carried on the run event so the UI routes on it without re-deriving from
   * `name`. Optional only for traces persisted before this field existed. */
  kind?: ToolKind;
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

/** Fields every previewable change carries, whatever its shape. */
interface WorkspaceSuggestionBase {
  id: string;
  /** The run that produced this change. File-level kinds apply through that
   *  run's review session (see reviewClient); bob's `replace` ignores it. */
  runId: string;
  filePath: string;
  title: string;
  status: WorkspaceSuggestionStatus;
  statusMessage: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * A previewable change awaiting the user's approval. bob proposes a byte-range
 * `replace` applied to the in-memory buffer; a write-capable harness reviewed
 * through the clone gate proposes whole-file `create` / `rewrite` / `delete`
 * applied to disk (see reviewClient + workspaceStore). One accept/reject UI
 * renders every kind.
 */
export type WorkspaceDocumentSuggestion =
  | WorkspaceReplaceSuggestion
  | WorkspaceCreateSuggestion
  | WorkspaceRewriteSuggestion
  | WorkspaceDeleteSuggestion;

/** bob's byte-range replacement, applied to the loaded buffer. */
export interface WorkspaceReplaceSuggestion extends WorkspaceSuggestionBase {
  kind: "replace";
  range: SourceRange;
  originalText: string;
  replacement: string;
}

/** A new file the assistant created in the review sandbox. */
export interface WorkspaceCreateSuggestion extends WorkspaceSuggestionBase {
  kind: "create";
  newText: string | null;
  newSize: number;
  previewOmitted: boolean;
}

/** A whole-file rewrite the assistant made in the sandbox. */
export interface WorkspaceRewriteSuggestion extends WorkspaceSuggestionBase {
  kind: "rewrite";
  originalText: string | null;
  newText: string | null;
  originalSize: number;
  newSize: number;
  previewOmitted: boolean;
  /** The live file changed since the run started — accepting overwrites it. */
  stale: boolean;
}

/** A file the assistant deleted in the sandbox. */
export interface WorkspaceDeleteSuggestion extends WorkspaceSuggestionBase {
  kind: "delete";
  originalText: string | null;
  originalSize: number;
  previewOmitted: boolean;
  stale: boolean;
}

/** bob's byte-range edit draft, before it becomes a pending suggestion. */
export interface WorkspaceSuggestionDraft {
  filePath: string;
  originalText: string;
  range: SourceRange;
  replacement: string;
  title: string;
}

/** A file-level change from the review gate, before it becomes a pending
 *  suggestion. The store maps a reviewClient `ReviewFileChange` into this. */
export interface WorkspaceReviewSuggestionDraft {
  kind: "create" | "rewrite" | "delete";
  filePath: string;
  originalText: string | null;
  newText: string | null;
  originalSize: number;
  newSize: number;
  previewOmitted: boolean;
  stale: boolean;
}

/** A file-level change a `snapshot`-mode run already made on disk — shown in
 *  the chat as an informational diff (undo via version history), never an
 *  accept/reject. No `stale`: there is nothing pending to overwrite. */
export interface WorkspaceAppliedChange {
  kind: "create" | "rewrite" | "delete";
  filePath: string;
  originalText: string | null;
  newText: string | null;
  originalSize: number;
  newSize: number;
  previewOmitted: boolean;
}

export interface SuggestedEditInput {
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

export type WorkspaceKind = "real" | "loose";

export const LOOSE_WORKSPACE_ID = "compose:loose";
export const LOOSE_WORKSPACE_NAME = "Open files";

export interface Workspace {
  activeFilePath: string;
  chatThread: WorkspaceChatThread;
  comments: WorkspaceCommentThread[];
  fileContents: Record<string, WorkspaceFileBuffer>;
  files: WorkspaceFileEntry[];
  /** Directory paths (incl. empty ones), so the tree shows folders with no
   *  markdown file. Sourced from `scanFolders`; files derive their own. */
  folders: string[];
  id: string;
  /**
   * `"real"` workspaces have a folder root at `path`; file entries hold
   * paths relative to that root. `"loose"` is a singleton pseudo-workspace
   * for files opened individually (Finder Open-With, `compose <file>`,
   * etc.) — `path` is `""` and file entries' `relativePath` field stores
   * the **absolute** path. The chat / comments / conversation surfaces
   * work identically on both.
   */
  kind: WorkspaceKind;
  lastOpenedAt?: number;
  lastSavedAt: Date | null;
  name: string;
  openFilePaths: string[];
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

export function isSetupComplete(
  selectedHarnessReadiness: HarnessReadiness | null,
  workspaces: Workspace[],
) {
  // "Set up" = the selected harness is installed and a workspace exists; the
  // key is checked at send.
  return Boolean(selectedHarnessReadiness?.installed) && workspaces.length > 0;
}

export function createWorkspaceFromPath(path: string): Workspace {
  const normalizedPath = normalizeWorkspacePath(path);

  return {
    activeFilePath: "",
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
    folders: [],
    id: createWorkspaceId(normalizedPath),
    kind: "real",
    lastSavedAt: null,
    name: workspaceNameFromPath(normalizedPath),
    openFilePaths: [],
    path: normalizedPath,
    scanError: null,
    scanState: "idle",
  };
}

/**
 * Build the singleton "Open files" workspace that houses files opened
 * individually (Finder Open-With, `compose <file>`). Files added later
 * to this workspace carry **absolute** paths in their `relativePath`
 * field — every IO path that consumes a workspace branches on `kind`.
 */
export function createLooseWorkspace(): Workspace {
  return {
    activeFilePath: "",
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
    folders: [],
    id: LOOSE_WORKSPACE_ID,
    kind: "loose",
    lastSavedAt: null,
    name: LOOSE_WORKSPACE_NAME,
    openFilePaths: [],
    path: "",
    scanError: null,
    scanState: "idle",
  };
}

export function createWorkspaceFromRecord(record: WorkspaceRecord): Workspace {
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
  existingWorkspaces: Workspace[],
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

/** Remove a file from the chat context by path (e.g. when it's deleted), leaving
 *  any other attached context untouched. */
export function removeFileContext(
  chatThread: WorkspaceChatThread,
  filePath: string,
): WorkspaceChatThread {
  return {
    ...chatThread,
    contextItems: chatThread.contextItems.filter(
      (item) => !(item.kind === "file" && item.path === filePath),
    ),
  };
}

/** Re-point a file already in the chat context to its new path on rename, so a
 *  pinned context survives the rename instead of dangling or being replaced. */
export function renameContextItemPath(
  chatThread: WorkspaceChatThread,
  workspaceId: string,
  from: string,
  to: string,
): WorkspaceChatThread {
  return {
    ...chatThread,
    contextItems: chatThread.contextItems.map((item) => {
      if (item.kind === "file" && item.path === from) {
        return { ...item, id: createContextId(workspaceId, to), label: to, path: to };
      }
      // A comment excerpt in chat references its file by path too (the prompt
      // emits `File: <filePath>`); re-point it so the agent never reads the old,
      // now-missing path (#32).
      if (item.kind === "comment" && item.filePath === from) {
        return { ...item, filePath: to, path: item.path === from ? to : item.path };
      }
      return item;
    }),
  };
}

/** Move an open tab to sit just before another, preserving the rest of the
 * order — drag-to-reorder (#29). The active file is untouched. */
export function reorderOpenTabs(
  openFilePaths: string[],
  fromPath: string,
  toPath: string,
): string[] {
  if (
    fromPath === toPath ||
    !openFilePaths.includes(fromPath) ||
    !openFilePaths.includes(toPath)
  ) {
    return openFilePaths;
  }
  const without = openFilePaths.filter((path) => path !== fromPath);
  without.splice(without.indexOf(toPath), 0, fromPath);
  return without;
}

export function openWorkspaceFile(workspace: Workspace, filePath: string): Workspace {
  const openFilePaths = workspace.openFilePaths.includes(filePath)
    ? workspace.openFilePaths
    : [...workspace.openFilePaths, filePath];

  // Opening / switching to a tab is navigation only — it must NOT repoint the
  // chat context, which the user controls explicitly (#30). The context defaults
  // to the active file at load and on a new chat, then stays pinned.
  return {
    ...workspace,
    activeFilePath: filePath,
    openFilePaths,
  };
}

export function closeWorkspaceFileTab(workspace: Workspace, filePath: string): Workspace {
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

  // Closing a tab is navigation too — leave the chat context as the user set it
  // (#30). A still-existing file can stay in context even with no tab open; a
  // deleted file is removed from context by deleteActiveFile.
  return {
    ...workspace,
    activeFilePath,
    fileContents: remainingFileContents,
    openFilePaths,
  };
}

/**
 * The file entries to render as open tabs — one per `openFilePaths`, in order.
 * An open path's real scan entry is used when present; when it's transiently
 * absent from `files` (a partial / racing scan on a large vault) a minimal
 * entry is synthesized from the path so the tab keeps rendering. A tab only
 * closes on a confirmed `removed` fs-event (see applyFsEvent) — never because a
 * scan momentarily omitted its file. The synthesized entry's size/mtime are
 * placeholders; PaneTabs reads only `relativePath`, and the dirty dot reads the
 * buffer, so they're never shown.
 */
export function resolveOpenTabs(workspace: Workspace): WorkspaceFileEntry[] {
  return workspace.openFilePaths.map(
    (filePath) =>
      workspace.files.find((entry) => entry.relativePath === filePath) ?? {
        relativePath: filePath,
        lastModifiedMs: 0,
        sizeBytes: 0,
      },
  );
}

/**
 * Whether the active file should render its document (vs the empty/Welcome
 * state). True when the active path is an open tab, has a loaded buffer, or is
 * in the scanned list — so a transient scan miss can't blank an open document.
 * The buffer/open-tab cases hold the document open while a (re)scan is missing
 * the file; only closing the tab (a confirmed deletion or the user's ✕) flips
 * this to false.
 */
export function isActiveFilePresent(workspace: Workspace): boolean {
  const path = workspace.activeFilePath;
  if (!path) {
    return false;
  }
  return (
    workspace.openFilePaths.includes(path) ||
    Boolean(workspace.fileContents[path]) ||
    workspace.files.some((entry) => entry.relativePath === path)
  );
}

export function applyScanResult(
  workspace: Workspace,
  entries: WorkspaceFileEntry[],
): Workspace {
  // A scan refreshes the file LIST only. It deliberately does NOT prune open
  // tabs, their buffers, comments, or the active file when a path is missing
  // from `entries`: a partial or racing scan would otherwise wipe the user's
  // open work (and the empty-tabs fallback would then swap in Welcome.md). A
  // genuine deletion closes its tab via the `removed` fs-event (applyFsEvent);
  // a tab whose file is truly gone just errors gracefully when opened.
  return {
    ...workspace,
    files: [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    scanError: null,
    scanState: "ready",
  };
}

export function applyFileBuffer(
  workspace: Workspace,
  relativePath: string,
  buffer: { content: string; lastModifiedMs: number },
): Workspace {
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


export function commentsForFile(workspace: Workspace, filePath: string) {
  return workspace.comments.filter(
    (comment) => comment.filePath === filePath && comment.status === "open",
  );
}

export function addWorkspaceComment(
  workspace: Workspace,
  input: {
    body: string;
    filePath: string;
    range: SourceRange;
    selectedText: string;
    timestamp: number;
  },
): Workspace {
  const buffer = workspace.fileContents[input.filePath];
  if (!buffer || !input.body.trim() || input.range.start >= input.range.end) {
    return workspace;
  }

  // One comment per highlight: if an open comment on this file overlaps the
  // selection, edit its note in place instead of stacking a duplicate. The
  // anchor stays put — you're editing the existing comment, not re-pinning it.
  const overlapping = workspace.comments.find(
    (existing) =>
      existing.filePath === input.filePath
      && existing.status === "open"
      && input.range.start < existing.anchor.range.end
      && existing.anchor.range.start < input.range.end,
  );
  if (overlapping) {
    return {
      ...workspace,
      comments: workspace.comments.map((existing) =>
        existing.id === overlapping.id
          ? { ...existing, body: input.body.trim(), updatedAt: input.timestamp }
          : existing,
      ),
    };
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
  workspace: Workspace,
  relativePath: string,
  content: string,
  changes: DocumentTextChange[],
  timestamp: number,
): Workspace {
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
  workspace: Workspace,
  edits: SuggestedEditInput[],
): WorkspaceSuggestionPreparation {
  const drafts: WorkspaceSuggestionDraft[] = [];
  let rejectedCount = 0;
  // One mapper per file content reused across edits targeting the same
  // buffer — a batch of suggestions from one harness turn typically hits the
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
  workspace: Workspace,
  fromFilePath: string,
  toFilePath: string,
  timestamp: number,
): Workspace {
  return {
    ...workspace,
    comments: moveCommentsToFile(workspace.comments, fromFilePath, toFilePath, timestamp),
  };
}

/** Flip a comment open ↔ resolved (the "done" state shown in the panel). */
export function setWorkspaceCommentStatus(
  workspace: Workspace,
  commentId: string,
  status: "open" | "resolved",
  timestamp: number,
): Workspace {
  return {
    ...workspace,
    comments: workspace.comments.map((comment) =>
      comment.id === commentId ? { ...comment, status, updatedAt: timestamp } : comment,
    ),
  };
}

function fileContextItem(workspaceId: string, filePath: string): WorkspaceFileContextItem {
  return {
    id: createContextId(workspaceId, filePath),
    kind: "file",
    label: filePath,
    path: filePath,
    workspaceId,
  };
}

/**
 * Add a file as chat context (deduped by id), with an explicit display label —
 * for an attachment whose label isn't its path (e.g. "Pasted text (12 KB)").
 * Re-adding the same path replaces the existing chip so the label stays current.
 */
export function addFileContextItem(
  chatThread: WorkspaceChatThread,
  workspaceId: string,
  filePath: string,
  label: string,
): WorkspaceChatThread {
  const item: WorkspaceFileContextItem = { ...fileContextItem(workspaceId, filePath), label };
  const withoutDup = chatThread.contextItems.filter((existing) => existing.id !== item.id);
  return { ...chatThread, contextItems: [...withoutDup, item] };
}

/** Remove a chat context item by id (a chip's ✕). */
export function removeContextItem(
  chatThread: WorkspaceChatThread,
  id: string,
): WorkspaceChatThread {
  return {
    ...chatThread,
    contextItems: chatThread.contextItems.filter((item) => item.id !== id),
  };
}

function commentContextItem(
  workspaceId: string,
  comment: WorkspaceCommentThread,
): WorkspaceContextItem {
  return {
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
  };
}

/**
 * Attach one or more comments (with their files, deduped) as the chat's
 * context — the basis for "Send N comments to chat". `createPromptWithContext`
 * already renders multiple comment blocks, so N just works downstream.
 */
export function setCommentsChatContext(
  chatThread: WorkspaceChatThread,
  workspaceId: string,
  comments: WorkspaceCommentThread[],
): WorkspaceChatThread {
  const seenFiles = new Set<string>();
  const fileItems: WorkspaceContextItem[] = [];
  const commentItems: WorkspaceContextItem[] = [];
  for (const comment of comments) {
    if (!seenFiles.has(comment.filePath)) {
      seenFiles.add(comment.filePath);
      fileItems.push(fileContextItem(workspaceId, comment.filePath));
    }
    commentItems.push(commentContextItem(workspaceId, comment));
  }
  return { ...chatThread, contextItems: [...fileItems, ...commentItems] };
}

export function setCommentChatContext(
  chatThread: WorkspaceChatThread,
  workspaceId: string,
  comment: WorkspaceCommentThread,
): WorkspaceChatThread {
  return setCommentsChatContext(chatThread, workspaceId, [comment]);
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
  workspace: Workspace,
  relativePath: string,
  content: string,
  changes: DocumentTextChange[] = [],
): Workspace {
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
  workspace: Workspace,
  relativePath: string,
  lastModifiedMs: number,
): Workspace {
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
  workspace: Workspace,
  relativePath: string,
): Workspace {
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
  workspace: Workspace,
  relativePath: string,
): Workspace {
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
  workspace: Workspace,
  event: WorkspaceFsEvent,
  /**
   * Whether this disk change is attributable to a just-run agent (a
   * `snapshot`-mode run editing the user's real files — see
   * `agentEditWindow.ts`). When true, an agent's edit to a file the user has
   * unsaved changes in **auto-reloads** instead of raising a conflict banner:
   * the edit is intended, already reviewed in-chat, and undoable via version
   * history. A genuine external edit (no agent run in flight) still conflicts.
   */
  agentEdit = false,
): { workspace: Workspace; effect: FsEventEffect } {
  if (event.kind === "removed") {
    // A confirmed deletion: close that file's tab + drop it from the list now,
    // rather than letting a rescan's absence do it — a transient scan miss must
    // not be mistaken for a deletion (see applyScanResult). Still rescan to
    // reconcile the rest of the tree (e.g. a directory removal).
    const closed = closeWorkspaceFileTab(workspace, event.relativePath);
    const files = closed.files.filter((entry) => entry.relativePath !== event.relativePath);
    return { workspace: { ...closed, files }, effect: { type: "rescan" } };
  }
  if (event.kind === "created") {
    return { workspace, effect: { type: "rescan" } };
  }

  const buffer = workspace.fileContents[event.relativePath];

  // Echo of our OWN write (autosave / manual save), or an older event:
  // the open buffer's mtime is already >= the event's. Return the
  // workspace UNCHANGED. We previously rebuilt `files` here to refresh the
  // entry's mtime, but that churns the `files` array reference on every
  // autosave-driven watcher echo and re-renders the entire file tree
  // (incl. each row's Carbon OverflowMenu) for nothing — confirmed via
  // react-scan. Conflict detection keys off the *buffer's* mtime, not the
  // file-entry's, so skipping the entry-mtime refresh here is safe.
  if (buffer && event.lastModifiedMs != null && event.lastModifiedMs <= buffer.lastModifiedMs) {
    return { workspace, effect: { type: "noop" } };
  }

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

  // A dirty buffer changing on disk is a conflict — *unless* the change is the
  // agent's own intended edit, in which case we auto-reload to the new content
  // (the conflict prompt would be redundant with the in-chat applied diff).
  if (buffer.dirty && !agentEdit) {
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

/** A globally-unique chat-message id. `conversation_messages.message_id` is a
 *  global primary key, so a per-conversation scheme like `message-1` collides
 *  the moment a second conversation persists its first message. */
function newMessageId(): string {
  return crypto.randomUUID();
}

export function appendUserChatMessage(
  chatThread: WorkspaceChatThread,
  userContent: string,
  preparedCommand: string | null,
  llmThreadId: string | null = null,
  excerpt: ChatExcerptRef | null = null,
): WorkspaceChatThread {
  const trimmedUserContent = userContent.trim();
  if (!trimmedUserContent) {
    return chatThread;
  }

  return {
    ...chatThread,
    messages: [
      ...chatThread.messages,
      {
        activity: null,
        content: trimmedUserContent,
        id: newMessageId(),
        ...(llmThreadId ? { llmThreadId } : {}),
        ...(excerpt ? { excerpt } : {}),
        role: "user",
      },
    ],
    preparedCommand,
    prompt: "",
  };
}

export function startRun(
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

export function markRunStreaming(
  chatThread: WorkspaceChatThread,
  runId: string,
): WorkspaceChatThread {
  if (chatThread.activeRunId !== runId) {
    return chatThread;
  }
  const placeholder: WorkspaceChatMessage = {
    activity: null,
    content: "",
    id: newMessageId(),
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
    id: newMessageId(),
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
  kind: ToolKind,
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
        kind,
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
        kind: "replace" as const,
        createdAt: timestamp,
        filePath: draft.filePath,
        id: `${messageId}-suggestion-${existingSuggestions.length + index + 1}`,
        originalText: draft.originalText,
        range: { ...draft.range },
        replacement: draft.replacement,
        runId,
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

/**
 * Attach file-level review changes (create / rewrite / delete, from the clone
 * gate) to a run's assistant message as pending suggestions. Unlike
 * `appendAssistantSuggestions` this runs *after* the run finished, so it finds
 * the message by `runId` rather than the active run.
 */
export function appendReviewChangeSuggestions(
  chatThread: WorkspaceChatThread,
  runId: string,
  drafts: WorkspaceReviewSuggestionDraft[],
  timestamp: number,
): WorkspaceChatThread {
  if (drafts.length === 0) {
    return chatThread;
  }
  const target = [...chatThread.messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.runId === runId);
  if (!target) {
    return chatThread;
  }
  const messageId = target.id;
  return {
    ...chatThread,
    messages: chatThread.messages.map((message) => {
      if (message.id !== messageId) {
        return message;
      }
      const existing = message.suggestions ?? [];
      const next = drafts.map((draft, index): WorkspaceDocumentSuggestion => {
        const base = {
          id: `${messageId}-suggestion-${existing.length + index + 1}`,
          runId,
          filePath: draft.filePath,
          title: reviewChangeTitle(draft.kind),
          status: "pending" as const,
          statusMessage: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        if (draft.kind === "create") {
          return {
            ...base,
            kind: "create",
            newText: draft.newText,
            newSize: draft.newSize,
            previewOmitted: draft.previewOmitted,
          };
        }
        if (draft.kind === "delete") {
          return {
            ...base,
            kind: "delete",
            originalText: draft.originalText,
            originalSize: draft.originalSize,
            previewOmitted: draft.previewOmitted,
            stale: draft.stale,
          };
        }
        return {
          ...base,
          kind: "rewrite",
          originalText: draft.originalText,
          newText: draft.newText,
          originalSize: draft.originalSize,
          newSize: draft.newSize,
          previewOmitted: draft.previewOmitted,
          stale: draft.stale,
        };
      });
      const total = existing.length + next.length;
      return {
        ...message,
        activity: `${total} change${total === 1 ? "" : "s"} to review`,
        suggestions: [...existing, ...next],
      };
    }),
  };
}

/**
 * Attach the file changes a `snapshot`-mode run already made to its assistant
 * message as informational `appliedChanges` (a diff to read, not approve). The
 * draft's `stale` flag is irrelevant here and dropped. Mirrors
 * `appendReviewChangeSuggestions`, minus the pending/accept machinery.
 */
export function appendAppliedChanges(
  chatThread: WorkspaceChatThread,
  runId: string,
  drafts: WorkspaceReviewSuggestionDraft[],
): WorkspaceChatThread {
  if (drafts.length === 0) {
    return chatThread;
  }
  const target = [...chatThread.messages]
    .reverse()
    .find((message) => message.role === "assistant" && message.runId === runId);
  if (!target) {
    return chatThread;
  }
  const messageId = target.id;
  return {
    ...chatThread,
    messages: chatThread.messages.map((message) => {
      if (message.id !== messageId) {
        return message;
      }
      const existing = message.appliedChanges ?? [];
      const next: WorkspaceAppliedChange[] = drafts.map((draft) => ({
        kind: draft.kind,
        filePath: draft.filePath,
        originalText: draft.originalText,
        newText: draft.newText,
        originalSize: draft.originalSize,
        newSize: draft.newSize,
        previewOmitted: draft.previewOmitted,
      }));
      const total = existing.length + next.length;
      return {
        ...message,
        activity: `${total} file${total === 1 ? "" : "s"} changed`,
        appliedChanges: [...existing, ...next],
      };
    }),
  };
}

function reviewChangeTitle(kind: WorkspaceReviewSuggestionDraft["kind"]): string {
  switch (kind) {
    case "create":
      return "New file";
    case "delete":
      return "Delete file";
    default:
      return "Updated file";
  }
}

export function acceptWorkspaceSuggestion(
  workspace: Workspace,
  suggestionId: string,
  timestamp: number,
): Workspace {
  const suggestion = findSuggestion(workspace.chatThread, suggestionId);
  if (!suggestion || suggestion.status !== "pending") {
    return workspace;
  }
  // Only bob's byte-range edits apply to the in-memory buffer here. File-level
  // changes (create / rewrite / delete from the clone gate) are applied to
  // disk through the review session by the store, which then marks status via
  // `markWorkspaceSuggestion`.
  if (suggestion.kind !== "replace") {
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
      statusMessage: "Source changed since this edit was suggested.",
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
  workspace: Workspace,
  suggestionId: string,
  timestamp: number,
): Workspace {
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

export interface FinalizeRunOptions {
  cancelled?: boolean;
  errorMessage?: string | null;
  exitCode?: number | null;
}

export function finalizeRun(
  chatThread: WorkspaceChatThread,
  runId: string,
  options: FinalizeRunOptions = {},
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
 * stats, runStatus>` per message. `trace`/`stats` are JSON-stringified (the
 * trace is already the consolidated `TraceEntry[]`; no transform).
 *
 * A *live* reply is persisted (with `runStatus: "streaming"`) even before any
 * text lands, so an incremental save during the run leaves a marker a
 * quit/crash can't clear — on next load that stale "streaming" reads as
 * interrupted. A clean finish clears `streaming`, so a settled turn persists
 * with no status. Empty, non-streaming placeholders are still skipped.
 */
export function serializeChatMessages(
  thread: WorkspaceChatThread,
): ConversationMessageRecord[] {
  return thread.messages
    .filter((message) => message.content.trim() || message.streaming || message.interrupted)
    .map((message, index) => {
      const runStatus = message.streaming
        ? "streaming"
        : message.interrupted
          ? "interrupted"
          : undefined;
      return {
        messageId: message.id || newMessageId(),
        role: message.role,
        content: message.content,
        ...(message.trace?.length ? { traceJson: JSON.stringify(message.trace) } : {}),
        ...(message.stats ? { statsJson: JSON.stringify(message.stats) } : {}),
        ...(runStatus ? { runStatus } : {}),
        createdAt: index,
      };
    });
}

/**
 * The display labels of the files currently attached as context — persisted
 * alongside a conversation so the history list can show its attached-file
 * chips. De-duplicated, file context items only (comment context is anchored
 * to a file already counted). Labels (not paths) since they're user-facing.
 */
export function chatThreadContextFileLabels(thread: WorkspaceChatThread): string[] {
  const labels = thread.contextItems
    .filter((item) => item.kind === "file")
    .map((item) => item.label);
  return Array.from(new Set(labels));
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
    // A reply still marked streaming/interrupted on disk had its run cut short
    // (the app quit/crashed mid-stream) — there's no live run on load, so
    // surface it as interrupted with a Retry rather than a dead "thinking…".
    ...(record.runStatus === "streaming" || record.runStatus === "interrupted"
      ? { interrupted: true }
      : {}),
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
// harness wire format. `SuggestedEditInput` stays — it's the
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

/**
 * Set a suggestion's status from outside the model — used by the store after
 * a file-level review change is applied (or fails) on disk, where the pure
 * model can't do the I/O itself.
 */
export function markWorkspaceSuggestion(
  workspace: Workspace,
  suggestionId: string,
  status: WorkspaceSuggestionStatus,
  statusMessage: string | null,
  timestamp: number,
): Workspace {
  return updateWorkspaceSuggestion(workspace, suggestionId, {
    status,
    statusMessage,
    updatedAt: timestamp,
  });
}

function updateWorkspaceSuggestion(
  workspace: Workspace,
  suggestionId: string,
  updates: Pick<WorkspaceDocumentSuggestion, "status" | "statusMessage" | "updatedAt">,
): Workspace {
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
 * Inline a file-context item's content only up to this many characters. A larger
 * file (or the pasted-text attachment) would crowd out a small (~4K) context
 * window, so it's referenced by path instead and the model reads it on demand
 * via the `read` tool. The single knob to tune for the context budget.
 */
export const FILE_CONTEXT_INLINE_LIMIT = 4000;

/**
 * Render the file-context block. With `inlineContent` (the openai-compatible /
 * local path), each item's content is inlined as `### <path>\n<content>` when
 * small enough, else reduced to a `- <path> (large; read it for details)`
 * pointer so a big attachment can't blow a small window. Without it (tool-native
 * CLI agents), every item is a bare `- <path>` reference the agent reads on
 * demand — smaller, always-current, cache-stable. Pure — takes the pre-fetched
 * content map so it stays unit-testable without IO.
 */
export function buildFileContextBlock(
  fileItems: WorkspaceFileContextItem[],
  contentByPath: Map<string, string>,
  inlineLimit = FILE_CONTEXT_INLINE_LIMIT,
  inlineContent = true,
): string {
  return fileItems
    .map((item) => {
      if (inlineContent) {
        const content = contentByPath.get(item.path);
        if (content != null && content.length <= inlineLimit) {
          return `### ${item.path}\n${content}`;
        }
        return `- ${item.path} (large; read it for details)`;
      }
      return `- ${item.path}`;
    })
    .join("\n\n");
}

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
 *
 * File context carries each attached file's CONTENT (budgeted — see
 * {@link buildFileContextBlock}), so a small model can act on an attached chip
 * without a separate read. `contentByPath` is pre-fetched by the caller
 * (keeping this function pure); a path missing from it falls back to a
 * read-on-demand reference.
 */
export function createPromptWithContext(
  prompt: string,
  contextItems: WorkspaceContextItem[],
  priorMessages: WorkspaceChatMessage[] = [],
  contentByPath: Map<string, string> = new Map(),
  inlineContent = true,
) {
  const trimmedPrompt = prompt.trim();

  const transcript = buildConversationTranscript(priorMessages);

  const fileContext = buildFileContextBlock(
    contextItems.filter((item): item is WorkspaceFileContextItem => item.kind === "file"),
    contentByPath,
    FILE_CONTEXT_INLINE_LIMIT,
    inlineContent,
  );
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
    fileContext
      ? `Context files${inlineContent ? "" : " (read these as needed)"}:\n${fileContext}`
      : null,
    // Scope edits to the intended files so the agent doesn't write to files the
    // user never asked it to touch (#31). A prompt guardrail, not a hard sandbox
    // (clone mode is the hard version) — but it makes the intended target explicit.
    fileContext
      ? "When you edit files, only modify the Context files listed above. Do not create or change any other file unless I explicitly ask you to."
      : null,
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
