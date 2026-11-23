import type { CommentAnchor, DocumentTextChange, SourceRange, WorkspaceCommentThread } from "../../features/comments/commentModel";
import type { ToolKind } from "../../lib/ipc/harnessRunClient";

/**
 * The workspace model's types: a workspace, its files and buffers, its chat thread and the agent changes in it.
 */

export type {
  DocumentTextChange,
  SourceRange,
  WorkspaceCommentThread,
} from "../../features/comments/commentModel";

export type WorkspaceContextItem = WorkspaceFileContextItem | WorkspaceCommentContextItem;

export interface WorkspaceFileContextItem {
  id: string;
  kind: "file";
  label: string;
  path: string;
  workspaceId: string;
  /** `"external"` = an external file: `path` is absolute, presence is
   *  judged against the external-files list, and content resolves from the
   *  loose buffer. Absent = a workspace file (relative path) or a spilled
   *  attachment (absolute, app scratch). */
  origin?: "external";
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
  /** The agent the active run goes to, as the chat names it; its reply carries it. */
  activeAgentName?: string;
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
  /** The agent that wrote this reply, named when its run started, so its
   *  changes stay credited to it after the writer switches agents. */
  agentName?: string;
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

/** `replaced`: a newer run started from this proposal and carries it forward. */
export type WorkspaceSuggestionStatus = "pending" | "accepted" | "rejected" | "stale" | "replaced";

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
  /** Whether the agent has been told the writer rejected the file (`WHOLE_FILE`). */
  review?: ReviewDecisions;
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
  /** Edits decided one at a time in the note's review margin. */
  review?: ReviewDecisions;
}

/**
 * Per-edit decisions made in the review margin, by edit key
 * (`features/review/agentEdits.ts`). `kept`: the change is in the note
 * (kept, or accepted); `dropped`: it is not (undone, or rejected).
 * `reported`: dropped edits the agent has been told about
 * (`features/review/reviewFeedback.ts`), so each is told once. A new file
 * or a deletion is one edit, keyed {@link WHOLE_FILE}.
 */
export interface ReviewDecisions {
  kept: readonly string[];
  dropped: readonly string[];
  reported: readonly string[];
}

/** The one edit key of a new file or a deletion, which is decided whole. */
export const WHOLE_FILE = "file";

/** A file the assistant deleted in the sandbox. */
export interface WorkspaceDeleteSuggestion extends WorkspaceSuggestionBase {
  kind: "delete";
  originalText: string | null;
  originalSize: number;
  previewOmitted: boolean;
  stale: boolean;
  /** Whether the agent has been told the writer rejected the deletion (`WHOLE_FILE`). */
  review?: ReviewDecisions;
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
  /** Unique within the conversation; the review margin records against it. */
  id: string;
  kind: "create" | "rewrite" | "delete";
  filePath: string;
  originalText: string | null;
  newText: string | null;
  originalSize: number;
  newSize: number;
  previewOmitted: boolean;
  review?: ReviewDecisions;
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
   * the **absolute** path. Loose files are plain documents: buffers, tabs,
   * and saves reuse the workspace machinery, while the workspace-scoped
   * surfaces (comments, history, index, agent context) don't apply — see
   * {@link documentCapabilities}.
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
  kind: "created" | "modified" | "removed" | "rescan" | "watch-error";
  lastModifiedMs: number | null;
  relativePath: string;
  /** Known for `created` (stat'd at emit time); absent for `removed`. */
  isDir?: boolean | null;
  /** File size at emit time, so a created note becomes a tree entry directly. */
  sizeBytes?: number | null;
}

export type FsEventEffect =
  | { type: "reloadFile"; relativePath: string }
  | { type: "rescan" }
  /** The tree structure changed in-place (entry added/removed) — persist tabs
   * and refresh the search index, but no scan is needed. */
  | { type: "treeChanged" }
  | { type: "noop" };
