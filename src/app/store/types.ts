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
   * Permission mode passed to a CLI harness that supports one (Claude Code's
   * `--permission-mode`). Unset → Compose's per-harness default (Claude runs
   * fully headless, so `bypassPermissions`; the edit-review gate is the undo
   * net). Set it to take over: `acceptEdits`, `auto`, `default`, … Threaded to
   * the harness via `extraArgs`, so it's config, never hardcoded.
   */
  permissionMode?: string;
  /**
   * Absolute path to this agent's executable, pinning runs to a specific vetted
   * binary instead of resolving the bare CLI name on PATH (the Runtimes panel's
   * "Set explicit path", for managed/EDR fleets). Threaded to the harness via
   * `RunTuning.binary_path`. Unset/empty → PATH resolution.
   */
  binaryPath?: string;
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
  /** Drag-to-reorder: move an open tab to sit just before another (#29). */
  reorderTab: (fromPath: string, toPath: string) => void;
  createNote: (seed?: { relativePath?: string; content?: string; dir?: string }) => Promise<void>;
  createFolder: (relativePath: string) => Promise<void>;
  /** Move a folder + its contents to trash and prune all state under it (#55). */
  deleteFolder: (folderPath: string) => Promise<void>;
  /**
   * Directory a plain "New note" lands in — set by selecting a folder (or a
   * file → its parent) in the tree. `""` = workspace root. Both the sidebar
   * "New note" button and the folder menu's "New note here" honor it; the
   * tree highlights the current target folder so it's visible where a note goes.
   */
  newNoteDir: string;
  setNewNoteDir: (dir: string) => void;
  deleteActiveFile: () => Promise<void>;
  dismissConflict: (relativePath: string) => void;
  handleFsEvent: (workspaceId: string, event: WorkspaceFsEvent) => Promise<void>;
  /** One reconciling scan (storm-guarded, min-interval on repeats) — the
   * consistency fallback behind watcher gaps and window-focus refreshes. */
  refreshWorkspaceTree: (workspaceId?: string) => Promise<void>;
  hydrateWorkspaces: (workspaceList: WorkspaceListResult) => void;
  onboarding: OnboardingState;
  onboardingComplete: () => boolean;
  setOnboarding: (onboarding: OnboardingState) => void;
  /** `attempt` is internal to the boot-scan backoff retry; callers pass nothing. */
  loadActiveWorkspaceFiles: (attempt?: number) => Promise<void>;
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
  /** Flush the active editor and write every dirty buffer (all workspaces, incl.
   *  background tabs) — the flush-on-quit that keeps closing the app from
   *  dropping unsaved edits (#43). */
  saveAllDirtyBuffers: () => Promise<void>;
  selectFile: (path: string) => Promise<void>;
  /** Read the active file's buffer if it isn't loaded — the invariant that keeps
   *  the editor off a stuck "Loading file…" when the active file changes without
   *  a read (closing/deleting a tab, restoring tabs). */
  ensureActiveBuffer: () => Promise<void>;
  rejectSuggestedEdit: (suggestionId: string) => void;
  sendChatPrompt: (options?: { readOnly?: boolean }) => Promise<void>;
  sendCommentToChat: (commentId: string) => Promise<void>;
  sendCommentsToChat: (commentIds: string[]) => Promise<void>;
  setChatPrompt: (prompt: string) => void;
  /** Clear a stale run-error banner after the agent recovers (Start Ollama / Retry). */
  dismissChatRunError: () => void;
  /** Attach a file as chat context (a chip in the context row). Used by the
   * large-paste handler, which spills the text to a file and adds its path. */
  addChatFileContext: (input: { label: string; path: string }) => void;
  /** Remove a chat context item by id (the chip's ✕). */
  removeChatContextItem: (id: string) => void;
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
