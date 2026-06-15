import type { StoreApi } from "zustand";
import type { ConversationSummary } from "../../lib/ipc/conversationsClient";
import type { ReasoningEffort } from "../../lib/ipc/harnessClient";
import type {
  Workspace,
  DocumentTextChange,
  OnboardingState,
  SourceRange,
  WorkspaceCommentThread,
  WorkspaceFileBuffer,
  WorkspaceFileEntry,
  WorkspaceFsEvent,
  WorkspaceListResult,
} from "../workspaceModel";

/**
 * One entry in the unified file+chat navigation history. Either the user was
 * looking at a file (`kind: "file"`, `id` = relative path) or at a chat
 * conversation (`kind: "chat"`, `id` = conversation id). `workspaceId` is
 * captured so a back-step can switch workspaces too if needed.
 */
export interface NavEntry {
  kind: "file" | "chat";
  id: string;
  workspaceId: string;
}

/**
 * Per-harness run tuning the Settings picker exposes. All optional —
 * an unset/empty field means "let the CLI use its own default". Maps to
 * `compose_core::RunTuning`; each adapter honors the subset it supports
 * (claude: model + maxTurns; codex: model + effort).
 */
export interface HarnessRunOptions {
  /** Model id or alias (`--model` / `-m`). Empty → CLI default. */
  model?: string;
  /** Codex reasoning effort. */
  effort?: ReasoningEffort;
  /** Claude max agentic turns. */
  maxTurns?: number;
  /**
   * Review a write-capable harness's edits before they touch your files.
   * Default ON: undefined is treated as enabled, so a fresh harness lands its
   * edits in a sandbox you approve. Set false to let it edit directly (still
   * undoable via a baseline snapshot). Ignored by harnesses that preview their
   * own edits (bob). See `editGuardFor`.
   */
  reviewEdits?: boolean;
  /**
   * Permission mode passed to a CLI harness that supports one (Claude Code's
   * `--permission-mode`). Unset → Compose's per-harness default (Claude runs
   * fully headless, so `bypassPermissions`; the edit-review gate is the undo
   * net). Set it to take over: `acceptEdits`, `auto`, `default`, … Threaded to
   * the harness via `extraArgs`, so it's config, never hardcoded.
   */
  permissionMode?: string;
}

export interface WorkspaceState {
  activeFileBuffer: () => WorkspaceFileBuffer | null;
  activeFileComments: () => WorkspaceCommentThread[];
  activeFileEntry: () => WorkspaceFileEntry | null;
  activeWorkspace: () => Workspace | null;
  activeWorkspaceId: string | null;
  addWorkspace: (path: string) => string;
  addCommentToActiveFile: (input: {
    body: string;
    range: SourceRange;
    selectedText: string;
  }) => void;
  /** Flip a comment open ↔ resolved (the panel's "done" state). */
  setCommentResolved: (commentId: string, resolved: boolean) => void;
  appendUserChatMessage: (userContent: string, preparedCommand: string | null) => void;
  acceptSuggestedEdit: (suggestionId: string) => void;
  /**
   * Open the chat panel, push a user message that quotes `selection.text`
   * as context, and stream the reply into the chat thread.
   *
   * Routes through the user's selected harness exactly like
   * `sendChatPrompt`: `runHarnessStream` with `harnessId` (the Rust runner
   * dispatches non-bob ids via `run_via_harness`) + a `subscribeHarnessRun`
   * subscription feeding the normalized events into `handleHarnessRunEvent`.
   * The bob credential/install preflight is gated on
   * `selectedHarnessId === "bob"` — the CLI harnesses authenticate via
   * their own login, so a missing login surfaces as that harness's own
   * run error rather than a "connect Bob" prompt. The run is always
   * `chatMode: "ask"` (read-only — a question about a selection never
   * edits the file), which maps to bob's `--chat-mode ask` and to
   * `RunMode::Ask` for the CLI harnesses.
   */
  askAboutSelectionStream: (
    question: string,
    selection: { range: SourceRange; text: string },
  ) => Promise<void>;
  cancelActiveRun: () => Promise<void>;
  /**
   * Per-window browser-style back/forward navigation across both files and
   * conversations. Each entry remembers what was active (file or chat) at that
   * point in the user's journey through THIS window; switching workspaces
   * pushes too (the next entry's `workspaceId` may differ). History is
   * window-local — each Tauri window has its own JS context, hence its own
   * Zustand store, hence its own stack. Not persisted across launches.
   */
  navHistory: NavEntry[];
  navIndex: number;
  /** Step back/forward through the unified history. No-op at the edges. */
  navigateBack: () => void;
  navigateForward: () => void;
  /**
   * Re-send the most recent user turn in this conversation as a new run. The
   * previous assistant reply is left as history; the regen lands as a fresh
   * turn. No-op if there is no preceding user turn or a run is already in
   * flight.
   */
  regenerateLastTurn: () => Promise<void>;
  closeFileTab: (filePath: string) => void;
  createNote: () => Promise<void>;
  deleteActiveFile: () => Promise<void>;
  dismissConflict: (relativePath: string) => void;
  handleFsEvent: (workspaceId: string, event: WorkspaceFsEvent) => Promise<void>;
  hydrateWorkspaces: (workspaceList: WorkspaceListResult) => void;
  onboarding: OnboardingState;
  onboardingComplete: () => boolean;
  setOnboarding: (onboarding: OnboardingState) => void;
  loadActiveWorkspaceFiles: () => Promise<void>;
  newChat: () => Promise<void>;
  /**
   * Per-workspace conversation history, newest activity first, *including*
   * archived ones (the UI filters by the `archived` flag). Keyed by
   * workspace id. Loaded on workspace open and refreshed after any mutation.
   */
  conversations: Record<string, ConversationSummary[]>;
  /** (Re)load the history list for a workspace from persistence. */
  loadConversations: (workspaceId: string) => Promise<void>;
  /** Open a conversation in the panel: hydrate its thread + bump its
   * last-opened. No-op while the current thread is mid-run. */
  openConversation: (conversationId: string) => Promise<void>;
  /**
   * Open a conversation from the sidebar Chat tab: reveals the chat pane if
   * hidden (without touching the editor pane) and pulses the panel border
   * to draw the eye. Delegates the hydrate/bookkeeping to
   * {@link openConversation}. */
  openConversationFromSidebar: (conversationId: string) => Promise<void>;
  /** Set (null clears to derived) a conversation's title — optimistic. */
  renameConversation: (conversationId: string, title: string | null) => Promise<void>;
  /** Archive / un-archive — optimistic; archiving the open one opens the next. */
  archiveConversation: (conversationId: string, archived: boolean) => Promise<void>;
  /** Soft-delete with a grace window: the row leaves the list immediately and
   * the persisted delete commits after a delay unless undone. */
  deleteConversation: (conversationId: string) => void;
  /** Cancel a pending delete within its grace window and restore the row. */
  undoDeleteConversation: (conversationId: string) => void;
  /** Duplicate a conversation and open the copy — optimistic. */
  duplicateConversation: (conversationId: string) => Promise<void>;
  /** Transient toast backing the post-delete undo affordance, or null. */
  conversationDeleteNotice: {
    workspaceId: string;
    conversationId: string;
    title: string;
  } | null;
  reloadActiveFile: () => Promise<void>;
  rebuildWorkspaceIndex: (workspaceId?: string) => Promise<void>;
  removeWorkspace: (workspaceId: string) => void;
  renameActiveFile: (toRelativePath: string) => Promise<void>;
  saveActiveFile: () => Promise<void>;
  selectFile: (path: string) => Promise<void>;
  rejectSuggestedEdit: (suggestionId: string) => void;
  sendChatPrompt: () => Promise<void>;
  sendCommentToChat: (commentId: string) => Promise<void>;
  sendCommentsToChat: (commentIds: string[]) => Promise<void>;
  setChatPrompt: (prompt: string) => void;
  switchWorkspace: (workspaceId: string) => void;
  updateActiveContent: (markdown: string, changes?: DocumentTextChange[]) => void;
  workspaces: Workspace[];
}

/** The store's `set`, typed against the full combined state — every slice
 * shares it, so cross-slice updates type-check. */
export type WorkspaceStoreSet = StoreApi<WorkspaceState>["setState"];
/** The store's `get`, typed against the full combined state — lets a slice
 * call actions that live in any other slice. */
export type WorkspaceStoreGet = StoreApi<WorkspaceState>["getState"];
