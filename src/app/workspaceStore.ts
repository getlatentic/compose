import { create, type StoreApi } from "zustand";
import {
  createFile as createFileIpc,
  deleteFile as deleteFileIpc,
  FileConflictError,
  readFile as readFileIpc,
  renameFile as renameFileIpc,
  scanWorkspace,
  writeFile as writeFileIpc,
} from "../lib/ipc/filesClient";
import {
  loadWorkspaceComments,
  saveWorkspaceComments,
} from "../lib/ipc/commentsClient";
import { rebuildWorkspaceIndex as rebuildWorkspaceIndexIpc } from "../lib/ipc/indexClient";
import { appendLlmMessage, recordLlmThread } from "../lib/ipc/llmContextClient";
import {
  archiveConversation as archiveConversationIpc,
  deleteConversation as deleteConversationIpc,
  duplicateConversation as duplicateConversationIpc,
  listConversations,
  loadActiveConversation,
  loadConversation,
  newConversation,
  renameConversation as renameConversationIpc,
  saveConversation,
  type ConversationSummary,
} from "../lib/ipc/conversationsClient";
import {
  checkBobInstall,
  getBobAuthStatus,
  type BobInstallStatus,
} from "../lib/ipc/settingsClient";
import { saveWorkspaceTabs } from "../lib/ipc/workspaceClient";
import {
  cancelHarnessRun as cancelHarnessRunIpc,
  harnessList,
  runHarnessStream,
  subscribeHarnessRun,
  DEFAULT_HARNESS_ID,
  type EditGuard,
  type HarnessRunEvent,
  type HarnessCapabilities,
  type HarnessInfo,
  type ReasoningEffort,
} from "../lib/ipc/bobClient";
import {
  applyReviewChange,
  reviewCleanup,
  reviewDiff,
  type ReviewFileChange,
} from "../lib/ipc/reviewClient";
import { markWorkspaceOpened } from "../lib/ipc/workspaceClient";
import {
  acceptWorkspaceSuggestion,
  appendAssistantText,
  appendAssistantNotice,
  appendAssistantThinking,
  appendAssistantSuggestions,
  appendReviewChangeSuggestions,
  markWorkspaceSuggestion,
  setAssistantSession,
  setAssistantStats,
  startAssistantToolCall,
  endAssistantToolCall,
  assistantMessageContentForRun,
  appendUserChatMessage,
  applyFileBuffer,
  applyFsEvent,
  applyScanResult,
  applyWorkspaceDocumentChanges,
  applyWorkspaceIndexSnapshot,
  bobRuntimeReadiness,
  chatThreadContextFileLabels,
  closeWorkspaceFileTab,
  addWorkspaceComment,
  createLlmContextSnapshots,
  createPromptWithContext,
  createWorkspaceFromPath,
  dismissBufferConflict,
  finalizeBobRun,
  hydrateChatThread,
  hydrateWorkspaceRecords,
  isSetupComplete,
  markBobRunStreaming,
  resetChatThread,
  serializeChatMessages,
  markBufferConflict,
  markBufferSaved,
  markWorkspaceIndexFailed,
  markWorkspaceIndexing,
  moveWorkspaceComments,
  closeWorkspacePane,
  openWorkspaceFile,
  openWorkspacePane,
  prepareWorkspaceSuggestionDrafts,
  rejectWorkspaceSuggestion,
  setAssistantActivity,
  setCommentChatContext,
  setCurrentTabContext,
  startBobRun,
  type BobAuthStatus,
  type BobWorkspace,
  type DocumentTextChange,
  type FinalizeBobRunOptions,
  type OnboardingState,
  type SourceRange,
  type WorkspacePane,
  type WorkspaceChatThread,
  type WorkspaceCommentThread,
  type WorkspaceDocumentSuggestion,
  type WorkspaceFileBuffer,
  type WorkspaceFileEntry,
  type WorkspaceFsEvent,
  type WorkspaceListResult,
  type WorkspaceReviewSuggestionDraft,
} from "./workspaceModel";

interface WorkspaceState {
  activeFileBuffer: () => WorkspaceFileBuffer | null;
  activeFileComments: () => WorkspaceCommentThread[];
  activeFileEntry: () => WorkspaceFileEntry | null;
  activeWorkspace: () => BobWorkspace | null;
  activeWorkspaceId: string | null;
  addWorkspace: (path: string) => string;
  addCommentToActiveFile: (input: {
    body: string;
    range: SourceRange;
    selectedText: string;
  }) => void;
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
  askBobAboutSelectionStream: (
    question: string,
    selection: { range: SourceRange; text: string },
  ) => Promise<void>;
  bobAuthStatus: BobAuthStatus;
  bobInstallStatus: BobInstallStatus | null;
  cancelActiveBobRun: () => Promise<void>;
  chatOpen: boolean;
  /**
   * Whether the comments side-panel is visible. Closed by default
   * so a fresh editor doesn't show an empty sidebar — opens on
   * demand via the header toggle. Persisted across reloads via the
   * same path the chat-open state uses.
   */
  commentsOpen: boolean;
  toggleComments: () => void;
  closeComments: () => void;
  openComments: () => void;
  /**
   * Editor display mode for the active file.
   *   * `wysiwyg` — styled live-preview rendering (headings as
   *     headings, bullets as glyphs, inline marks applied). Default.
   *   * `source`  — raw markdown text. Same canvas surface, same
   *     input pipeline, but the renderer projects the literal
   *     bytes instead of styled segments. Used when the user wants
   *     to see / hand-edit the markdown markers the WYSIWYG mode
   *     hides.
   *
   * Stored per session (not persisted) — switching files starts in
   * whatever the last mode was. The markdown file on disk is the
   * single source of truth; both modes render from the same buffer.
   */
  editorMode: "wysiwyg" | "source";
  toggleEditorMode: () => void;
  closeFileTab: (filePath: string) => void;
  closeChat: () => void;
  createNote: () => Promise<void>;
  deleteActiveFile: () => Promise<void>;
  dismissConflict: (relativePath: string) => void;
  handleFsEvent: (workspaceId: string, event: WorkspaceFsEvent) => Promise<void>;
  hydrateWorkspaces: (workspaceList: WorkspaceListResult) => void;
  onboarding: OnboardingState;
  onboardingComplete: () => boolean;
  setOnboarding: (onboarding: OnboardingState) => void;
  showDashboard: () => void;
  viewMode: "dashboard" | "workspace";
  loadActiveWorkspaceFiles: () => Promise<void>;
  openChat: () => void;
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
  saveError: string | null;
  selectFile: (path: string) => Promise<void>;
  rejectSuggestedEdit: (suggestionId: string) => void;
  sendChatPrompt: () => Promise<void>;
  sendCommentToChat: (commentId: string) => Promise<void>;
  setBobAuthStatus: (status: BobAuthStatus) => void;
  setBobInstallStatus: (status: BobInstallStatus | null) => void;
  setChatPrompt: (prompt: string) => void;
  setupComplete: () => boolean;
  /**
   * Whether the settings sheet is open. Lifted out of `AppShell`'s
   * local state because the Ask/Edit flows need to open it
   * imperatively when Bob isn't connected — they live deep in the
   * editor tree and the store is the cleanest shared channel.
   */
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  /**
   * Non-file panes (Settings today; terminal / browser later) hosted in
   * the active workspace's editor tab strip. `openPane` opens-or-focuses,
   * `selectPane` activates an already-open pane, `closePane` removes it.
   */
  openPane: (pane: WorkspacePane) => void;
  closePane: (paneId: string) => void;
  selectPane: (paneId: string) => void;
  /**
   * The harness the user picked (bob / claude / codex / …). Sent as
   * `harnessId` on every run so the Rust side routes to it. Persisted
   * across sessions. Defaults to bob.
   */
  selectedHarnessId: string;
  /**
   * Whether the active harness may edit files in the workspace. The
   * single onboarding permission toggle — maps to the run's Ask vs
   * Edit mode. Persisted.
   */
  allowEdits: boolean;
  /**
   * Per-harness run tuning (model, effort, max-turns), keyed by harness
   * id. Forwarded on every run as `runHarnessStream` tuning. Persisted.
   */
  harnessOptions: Record<string, HarnessRunOptions>;
  setSelectedHarness: (harnessId: string) => void;
  setAllowEdits: (allow: boolean) => void;
  /** Merge a partial options patch into one harness's stored options. */
  setHarnessOptions: (harnessId: string, options: Partial<HarnessRunOptions>) => void;
  /**
   * Declarative capabilities for every registered harness, loaded once
   * at bootstrap. The source of truth for credential gating and the
   * options UI — read via {@link harnessCapabilitiesOf} rather than
   * comparing ids. Empty in the browser preview (the registry is
   * desktop-only), where the static fallback applies.
   */
  harnessCatalog: HarnessInfo[];
  loadHarnessCatalog: () => Promise<void>;
  switchWorkspace: (workspaceId: string) => void;
  toggleChat: () => void;
  updateActiveContent: (markdown: string, changes?: DocumentTextChange[]) => void;
  workspaces: BobWorkspace[];
}

function updateWorkspace(
  workspaces: BobWorkspace[],
  workspaceId: string,
  transform: (workspace: BobWorkspace) => BobWorkspace,
): BobWorkspace[] {
  return workspaces.map((workspace) =>
    workspace.id === workspaceId ? transform(workspace) : workspace,
  );
}

const HARNESS_PREFS_KEY = "compose.harnessPrefs";

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
}

interface HarnessPrefs {
  selectedHarnessId: string;
  allowEdits: boolean;
  /** Keyed by harness id (`bob` / `claude` / `codex`). */
  harnessOptions: Record<string, HarnessRunOptions>;
}

/** Load the persisted harness selection + edit permission + per-harness
 * run options. Defaults to bob + edits-allowed + no options (matches the
 * onboarding recommended path). */
function loadHarnessPrefs(): HarnessPrefs {
  const fallback: HarnessPrefs = { selectedHarnessId: "bob", allowEdits: true, harnessOptions: {} };
  if (typeof localStorage === "undefined") {
    return fallback;
  }
  try {
    const raw = localStorage.getItem(HARNESS_PREFS_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<HarnessPrefs>;
    return {
      selectedHarnessId:
        typeof parsed.selectedHarnessId === "string" && parsed.selectedHarnessId
          ? parsed.selectedHarnessId
          : fallback.selectedHarnessId,
      allowEdits: typeof parsed.allowEdits === "boolean" ? parsed.allowEdits : fallback.allowEdits,
      harnessOptions:
        parsed.harnessOptions && typeof parsed.harnessOptions === "object"
          ? (parsed.harnessOptions as Record<string, HarnessRunOptions>)
          : fallback.harnessOptions,
    };
  } catch {
    return fallback;
  }
}

function persistHarnessPrefs(prefs: HarnessPrefs) {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(HARNESS_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort; ignore quota / availability errors.
  }
}

const INITIAL_HARNESS_PREFS = loadHarnessPrefs();

/**
 * Capabilities for a harness, read from the loaded catalog. When the
 * catalog isn't loaded yet (browser preview, or before bootstrap) it
 * falls back to the static defaults: the default harness (bob) manages
 * a credential and previews edits, any other id is a login-managed CLI.
 * Every credential/preview branch reads this instead of comparing the
 * harness id to `"bob"`.
 */
export function harnessCapabilitiesOf(
  catalog: HarnessInfo[],
  harnessId: string,
): HarnessCapabilities {
  const info = catalog.find((entry) => entry.id === harnessId);
  if (info) {
    return info.capabilities;
  }
  const isDefault = harnessId === DEFAULT_HARNESS_ID;
  return {
    credentialRequired: isDefault,
    previewsEdits: isDefault,
    models: [],
    allowsCustomModel: false,
    supportsEffort: false,
    supportsMaxTurns: false,
    supportsLogin: false,
  };
}

/**
 * Pick the edit-review mode for a run. bob previews its own edits (no gate);
 * a read-only plan/ask run makes no edits to guard; otherwise a write-capable
 * harness runs under review by default — `clone` (sandbox + approve) unless the
 * user turned review off, where `snapshot` still records an undo baseline.
 */
export function editGuardFor(
  capabilities: HarnessCapabilities,
  allowEdits: boolean,
  options: HarnessRunOptions,
): EditGuard {
  if (capabilities.previewsEdits) {
    return "none";
  }
  if (!allowEdits) {
    return "none";
  }
  return options.reviewEdits === false ? "snapshot" : "clone";
}

/** Map a clone-diff file change into a pending review suggestion draft. */
export function reviewChangeToDraft(change: ReviewFileChange): WorkspaceReviewSuggestionDraft {
  const kind =
    change.kind === "created" ? "create" : change.kind === "deleted" ? "delete" : "rewrite";
  return {
    kind,
    filePath: change.relativePath,
    originalText: change.originalText,
    newText: change.newText,
    originalSize: change.originalSize,
    newSize: change.newSize,
    previewOmitted: change.previewOmitted,
    stale: change.stale,
  };
}

/** Find a suggestion by id across a workspace's chat messages. */
function findWorkspaceSuggestion(
  workspace: BobWorkspace,
  suggestionId: string,
): WorkspaceDocumentSuggestion | null {
  for (const message of workspace.chatThread.messages) {
    const found = message.suggestions?.find((suggestion) => suggestion.id === suggestionId);
    if (found) {
      return found;
    }
  }
  return null;
}

/** Count still-pending file-level (clone-gate) suggestions for a run. */
function pendingReviewSuggestionCount(workspace: BobWorkspace, runId: string): number {
  let count = 0;
  for (const message of workspace.chatThread.messages) {
    for (const suggestion of message.suggestions ?? []) {
      if (
        suggestion.runId === runId &&
        suggestion.kind !== "replace" &&
        suggestion.status === "pending"
      ) {
        count += 1;
      }
    }
  }
  return count;
}

/** Discard a run's review sandbox once no file-level changes remain pending. */
function maybeCleanupReview(
  get: StoreApi<WorkspaceState>["getState"],
  workspaceId: string,
  runId: string,
) {
  const workspace = get().workspaces.find((item) => item.id === workspaceId);
  if (workspace && pendingReviewSuggestionCount(workspace, runId) === 0) {
    void reviewCleanup(runId).catch(() => {
      // best-effort — the sandbox is a temp dir the OS reclaims anyway
    });
  }
}

/**
 * After a reviewed (clone-gate) run finishes, diff the sandbox against the
 * live workspace and attach the file-level changes as pending suggestions. A
 * cancelled run, an empty diff, or a diff failure tears the sandbox down
 * instead.
 */
async function finishReviewRun(
  set: StoreApi<WorkspaceState>["setState"],
  workspaceId: string,
  runId: string,
  editGuard: EditGuard,
  cancelled: boolean,
): Promise<void> {
  if (editGuard !== "clone") {
    return;
  }
  if (cancelled) {
    await reviewCleanup(runId).catch(() => {});
    return;
  }
  let changes: ReviewFileChange[];
  try {
    changes = await reviewDiff(runId);
  } catch (error) {
    set({ saveError: errorMessage(error, "Could not compare the assistant's changes") });
    await reviewCleanup(runId).catch(() => {});
    return;
  }
  if (changes.length === 0) {
    await reviewCleanup(runId).catch(() => {});
    return;
  }
  const drafts = changes.map(reviewChangeToDraft);
  set((state) => ({
    workspaces: updateWorkspace(state.workspaces, workspaceId, (workspace) => ({
      ...workspace,
      chatThread: appendReviewChangeSuggestions(workspace.chatThread, runId, drafts, Date.now()),
    })),
  }));
}

/**
 * Apply one approved file-level change to disk through the run's review
 * session, then record the outcome on its suggestion (accepted, or stale if
 * the file moved under us). Tears the sandbox down once nothing is pending.
 */
async function applyFileReviewChange(
  set: StoreApi<WorkspaceState>["setState"],
  get: StoreApi<WorkspaceState>["getState"],
  workspaceId: string,
  suggestion: WorkspaceDocumentSuggestion,
): Promise<void> {
  try {
    await applyReviewChange(suggestion.runId, suggestion.filePath);
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspaceId, (workspace) =>
        markWorkspaceSuggestion(workspace, suggestion.id, "accepted", null, Date.now()),
      ),
    }));
  } catch (error) {
    const message = errorMessage(error, "Could not apply this change");
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspaceId, (workspace) =>
        markWorkspaceSuggestion(workspace, suggestion.id, "stale", message, Date.now()),
      ),
    }));
  }
  maybeCleanupReview(get, workspaceId, suggestion.runId);
}

function persistTabs(workspaces: BobWorkspace[], workspaceId: string) {
  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    return;
  }
  void saveWorkspaceTabs(workspaceId, workspace.activeFilePath, workspace.openFilePaths).catch(
    () => {
      // best-effort — tab state isn't critical
    },
  );
}

/**
 * Fire-and-forget persist of a workspace's active conversation (settled
 * turns only — `serializeChatMessages` skips in-flight messages). Called
 * on send and on turn completion; a no-op when the thread has no
 * conversation id yet. Best-effort, off the input thread. Persists the
 * thread's context-file labels too (so the history list shows file chips),
 * and refreshes the history list once the save commits so titles / previews
 * / counts stay live.
 */
function persistConversation(get: StoreApi<WorkspaceState>["getState"], workspaceId: string) {
  const workspace = get().workspaces.find((item) => item.id === workspaceId);
  const conversationId = workspace?.chatThread.conversationId;
  if (!workspace || !conversationId) {
    return;
  }
  void saveConversation(
    workspaceId,
    conversationId,
    serializeChatMessages(workspace.chatThread),
    chatThreadContextFileLabels(workspace.chatThread),
  )
    .then(() => {
      void get().loadConversations(workspaceId);
    })
    .catch(() => {
      // best-effort — a failed save shouldn't disrupt the chat
    });
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Grace window for the soft-delete undo affordance. The conversation leaves
 * the list immediately, but the persisted delete only commits after this
 * delay — so an Undo within the window cancels the IPC entirely and the row
 * is restored with no server round-trip.
 */
const CONVERSATION_DELETE_GRACE_MS = 6000;

/** Pending soft-deletes keyed by `${workspaceId}:${conversationId}`, so Undo
 * can cancel the timer before it fires. Module-level: timers outlive any one
 * render and there is exactly one store. */
const conversationDeleteTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Replace one workspace's conversation list via a transform. */
function patchConversationList(
  conversations: Record<string, ConversationSummary[]>,
  workspaceId: string,
  transform: (list: ConversationSummary[]) => ConversationSummary[],
): Record<string, ConversationSummary[]> {
  return { ...conversations, [workspaceId]: transform(conversations[workspaceId] ?? []) };
}

/**
 * After the open conversation leaves the active set (archived or deleted),
 * open the next most-recent non-archived one — or reset to a fresh empty
 * chat when none remain. Reads the (already optimistically-updated) list.
 */
function openNextConversationOrReset(
  get: StoreApi<WorkspaceState>["getState"],
  set: StoreApi<WorkspaceState>["setState"],
  workspaceId: string,
  excludeId: string,
): Promise<void> {
  const next = (get().conversations[workspaceId] ?? []).find(
    (item) => item.conversationId !== excludeId && !item.archived,
  );
  if (next) {
    return get().openConversation(next.conversationId);
  }
  set((state) => ({
    workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => ({
      ...item,
      chatThread: { ...resetChatThread(item.chatThread), conversationId: null },
    })),
  }));
  return Promise.resolve();
}

function persistComments(
  workspaces: BobWorkspace[],
  workspaceId: string,
  onError: (message: string) => void,
) {
  const workspace = workspaces.find((item) => item.id === workspaceId);
  if (!workspace) {
    return;
  }
  void saveWorkspaceComments(workspaceId, workspace.comments).catch((error) =>
    onError(errorMessage(error, "Could not persist comment metadata")),
  );
}

const activeRunSubscriptions = new Map<string, () => void>();

function handleHarnessRunEvent(
  event: HarnessRunEvent,
  runId: string,
  updateWorkspaceForRun: (updater: (current: BobWorkspace) => BobWorkspace) => void,
  finalize: (options: FinalizeBobRunOptions) => void,
  onFinished?: (result: { cancelled: boolean }) => void,
) {
  if (event.runId !== runId) {
    return;
  }
  // The Rust side now emits the normalized `compose_core::RunEvent`
  // stream (bob's stream-json is parsed into these by the harness
  // adapter), so this handler never parses a harness wire format —
  // it just applies already-decoded events. See `bobClient.ts`.
  // Each event appends to the active message's ordered trace (or the
  // answer bubble for `text`); the live status indicator is derived from
  // the trace's last entry in the UI, so this handler sets no status.
  switch (event.kind) {
    case "started":
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: markBobRunStreaming(current.chatThread, runId),
      }));
      return;
    case "text":
      // The answer (bob: only attempt_completion; Claude/Codex: streamed
      // text). Goes to the bubble, replacing the live status.
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: appendAssistantText(current.chatThread, runId, event.delta),
      }));
      return;
    case "notice":
      // Narration — appended to the trace (and the last entry drives the
      // live status indicator).
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: appendAssistantNotice(current.chatThread, runId, event.message),
      }));
      return;
    case "thinking":
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: appendAssistantThinking(current.chatThread, runId, event.delta),
      }));
      return;
    case "toolStart":
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: startAssistantToolCall(
          current.chatThread,
          runId,
          event.toolCallId,
          event.name,
          event.toolKind,
          event.input,
        ),
      }));
      return;
    case "toolEnd":
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: endAssistantToolCall(current.chatThread, runId, event.toolCallId, event.ok, event.output),
      }));
      return;
    case "session":
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: setAssistantSession(current.chatThread, runId, event.sessionId),
      }));
      return;
    case "usage":
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: setAssistantStats(current.chatThread, runId, {
          ...(event.totalTokens != null ? { totalTokens: event.totalTokens } : {}),
          ...(event.toolCalls != null ? { toolCalls: event.toolCalls } : {}),
          ...(event.coins != null ? { coins: event.coins } : {}),
        }),
      }));
      return;
    case "suggestedEdits": {
      // Wire edits omit `title` when absent; the app shape wants
      // `null`. Map once, then prepare drafts (needs the workspace
      // content + PositionMapper, which is why this stays TS-side).
      const inputs = event.edits.map((edit) => ({
        filePath: edit.filePath,
        range: edit.range,
        replacement: edit.replacement,
        title: edit.title ?? null,
      }));
      updateWorkspaceForRun((current) => {
        const prepared = prepareWorkspaceSuggestionDrafts(current, inputs);
        let chatThread = appendAssistantSuggestions(
          current.chatThread,
          runId,
          prepared.drafts,
          Date.now(),
        );
        if (prepared.rejectedCount > 0) {
          chatThread = setAssistantActivity(
            chatThread,
            runId,
            `${prepared.rejectedCount} suggested edit${prepared.rejectedCount === 1 ? "" : "s"} could not be prepared`,
          );
        }
        return { ...current, chatThread };
      });
      return;
    }
    case "activity":
      updateWorkspaceForRun((current) => ({
        ...current,
        chatThread: setAssistantActivity(current.chatThread, runId, event.message),
      }));
      return;
    case "error":
      finalize({ errorMessage: event.message });
      return;
    case "exited":
      finalize({ cancelled: event.cancelled, exitCode: event.exitCode });
      // Terminal: a reviewed run now diffs its sandbox and surfaces the
      // changes for approval (or tears the sandbox down). `error` always
      // precedes `exited`, so this fires exactly once per run.
      onFinished?.({ cancelled: event.cancelled });
      return;
    default:
      return;
  }
}

function unsubscribeRun(runId: string) {
  const unsubscribe = activeRunSubscriptions.get(runId);
  if (unsubscribe) {
    unsubscribe();
    activeRunSubscriptions.delete(runId);
  }
}

type SetWorkspaceState = (
  partial: (state: { workspaces: BobWorkspace[] }) => { workspaces: BobWorkspace[] },
) => void;

/**
 * rAF-batched setter for streaming runs.
 *
 * Bob emits one event per token (and parsers emit several state
 * changes per stdout line — text append, activity update, suggestion
 * prep). Without batching, each event triggers a full Zustand
 * notification → React render → renderer paint. At streaming speeds
 * (~50+ events/sec) this saturates the main thread and the whole UI
 * stalls.
 *
 * Strategy: queue updaters, coalesce into one `set()` per animation
 * frame. The updaters are `(workspace) => workspace`, so folding
 * `N` of them is a linear pass that produces a single state
 * transition. `flushNow()` forces a synchronous flush for terminal
 * events (finalize / error) where the next set() must observe all
 * queued work.
 *
 * One batcher per run — finalize disposes it. No global queue, no
 * cross-run interleaving.
 */
function createBatchedRunSetter(set: SetWorkspaceState, workspaceId: string) {
  let pending: Array<(current: BobWorkspace) => BobWorkspace> = [];
  let rafHandle: number | null = null;

  const flush = () => {
    rafHandle = null;
    if (pending.length === 0) {
      return;
    }
    const updaters = pending;
    pending = [];
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => {
        let next = item;
        for (const updater of updaters) {
          next = updater(next);
        }
        return next;
      }),
    }));
  };

  const schedule = () => {
    if (rafHandle != null) {
      return;
    }
    if (typeof requestAnimationFrame === "function") {
      rafHandle = requestAnimationFrame(flush);
    } else {
      // SSR / test fallback — flush on next microtask.
      rafHandle = 1;
      queueMicrotask(() => {
        rafHandle = null;
        flush();
      });
    }
  };

  return {
    updateWorkspaceForRun(updater: (current: BobWorkspace) => BobWorkspace) {
      pending.push(updater);
      schedule();
    },
    updateThread(updater: (current: WorkspaceChatThread) => WorkspaceChatThread) {
      pending.push((workspace) => ({ ...workspace, chatThread: updater(workspace.chatThread) }));
      schedule();
    },
    flushNow() {
      if (rafHandle != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafHandle);
      }
      rafHandle = null;
      flush();
    },
    dispose() {
      if (rafHandle != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(rafHandle);
      }
      rafHandle = null;
      pending = [];
    },
  };
}

function persistedRunBody(
  thread: WorkspaceChatThread,
  runId: string,
  options: FinalizeBobRunOptions,
) {
  const assistantBody = assistantMessageContentForRun(thread, runId);
  if (assistantBody) {
    return { body: assistantBody, role: "assistant" as const };
  }
  if (options.cancelled) {
    return { body: "Run cancelled", role: "system" as const };
  }
  if (options.errorMessage) {
    return { body: options.errorMessage, role: "system" as const };
  }
  if (typeof options.exitCode === "number" && options.exitCode !== 0) {
    return { body: `The assistant exited with code ${options.exitCode}`, role: "system" as const };
  }
  return null;
}

function nextUntitledPath(workspace: BobWorkspace): string {
  const existing = new Set([
    ...workspace.files.map((entry) => entry.relativePath),
    ...workspace.openFilePaths,
  ]);
  let index = 1;
  while (existing.has(`notes/untitled-${index}.md`)) {
    index += 1;
  }
  return `notes/untitled-${index}.md`;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  activeFileBuffer: () => {
    const workspace = get().activeWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return null;
    }
    return workspace.fileContents[workspace.activeFilePath] ?? null;
  },
  activeFileComments: () => {
    const workspace = get().activeWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return [];
    }
    return workspace.comments.filter(
      (comment) => comment.filePath === workspace.activeFilePath && comment.status === "open",
    );
  },
  activeFileEntry: () => {
    const workspace = get().activeWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return null;
    }
    return (
      workspace.files.find((entry) => entry.relativePath === workspace.activeFilePath) ?? null
    );
  },
  activeWorkspace: () => {
    const { activeWorkspaceId, workspaces } = get();
    return workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  },
  activeWorkspaceId: null,
  addWorkspace: (path: string) => {
    const workspace = createWorkspaceFromPath(path);

    set((state) => {
      const existingWorkspace = state.workspaces.find((item) => item.id === workspace.id);
      if (existingWorkspace) {
        return {
          activeWorkspaceId: existingWorkspace.id,
        };
      }

      return {
        activeWorkspaceId: workspace.id,
        workspaces: [...state.workspaces, workspace],
      };
    });

    return workspace.id;
  },
  addCommentToActiveFile: ({ body, range, selectedText }) => {
    const workspace = get().activeWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return;
    }

    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
        addWorkspaceComment(item, {
          body,
          filePath: item.activeFilePath,
          range,
          selectedText,
          timestamp: Date.now(),
        }),
      ),
    }));
    persistComments(get().workspaces, workspace.id, (message) => set({ saveError: message }));
  },
  appendUserChatMessage: (userContent: string, preparedCommand: string | null) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }

    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => ({
        ...item,
        chatThread: appendUserChatMessage(item.chatThread, userContent, preparedCommand),
      })),
    }));
  },
  acceptSuggestedEdit: (suggestionId: string) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    const suggestion = findWorkspaceSuggestion(workspace, suggestionId);
    if (!suggestion || suggestion.status !== "pending") {
      return;
    }
    // File-level changes (create / rewrite / delete) from the clone gate apply
    // to disk through the run's review session; the file watcher then refreshes
    // any open buffer. bob's byte-range `replace` applies to the in-memory
    // buffer here as before.
    if (suggestion.kind !== "replace") {
      void applyFileReviewChange(set, get, workspace.id, suggestion);
      return;
    }

    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
        acceptWorkspaceSuggestion(item, suggestionId, Date.now()),
      ),
    }));
    persistComments(get().workspaces, workspace.id, (message) => set({ saveError: message }));
  },
  bobAuthStatus: { configured: false },
  bobInstallStatus: null,
  cancelActiveBobRun: async () => {
    const workspace = get().activeWorkspace();
    const runId = workspace?.chatThread.activeRunId ?? null;
    if (!workspace || !runId) {
      return;
    }
    try {
      await cancelHarnessRunIpc(runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not cancel the run";
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => ({
          ...item,
          chatThread: finalizeBobRun(item.chatThread, runId, { errorMessage: message }),
        })),
      }));
      unsubscribeRun(runId);
    }
  },
  chatOpen: true,
  // Comments panel starts hidden — see the field's docstring above.
  commentsOpen: false,
  toggleComments: () => {
    set((state) => ({ commentsOpen: !state.commentsOpen }));
  },
  openComments: () => {
    set({ commentsOpen: true });
  },
  closeComments: () => {
    set({ commentsOpen: false });
  },
  editorMode: "wysiwyg",
  toggleEditorMode: () => {
    set((state) => ({
      editorMode: state.editorMode === "wysiwyg" ? "source" : "wysiwyg",
    }));
  },
  closeFileTab: (filePath: string) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }

    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
        closeWorkspaceFileTab(item, filePath),
      ),
    }));
    persistTabs(get().workspaces, workspace.id);
  },
  closeChat: () => {
    set({ chatOpen: false });
  },
  createNote: async () => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }

    const relativePath = nextUntitledPath(workspace);
    const content = `# Untitled\n\n`;

    try {
      const result = await createFileIpc(workspace.id, relativePath, content);
      const newEntry: WorkspaceFileEntry = {
        lastModifiedMs: result.lastModifiedMs,
        relativePath,
        sizeBytes: content.length,
      };
      set((state) => ({
        saveError: null,
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => {
          const filesWithNew = item.files.some((entry) => entry.relativePath === relativePath)
            ? item.files
            : [...item.files, newEntry].sort((a, b) =>
                a.relativePath.localeCompare(b.relativePath),
              );
          const withBuffer = applyFileBuffer(item, relativePath, {
            content,
            lastModifiedMs: result.lastModifiedMs,
          });
          return openWorkspaceFile({ ...withBuffer, files: filesWithNew }, relativePath);
        }),
      }));
      persistTabs(get().workspaces, workspace.id);
      void get().rebuildWorkspaceIndex(workspace.id);
    } catch (error) {
      set({ saveError: error instanceof Error ? error.message : "Could not create note" });
    }
  },
  deleteActiveFile: async () => {
    const workspace = get().activeWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return;
    }
    const filePath = workspace.activeFilePath;

    try {
      await deleteFileIpc(workspace.id, filePath);
      set((state) => ({
        saveError: null,
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => {
          const withoutTab = closeWorkspaceFileTab(item, filePath);
          return {
            ...withoutTab,
            comments: withoutTab.comments.filter((comment) => comment.filePath !== filePath),
            files: withoutTab.files.filter((entry) => entry.relativePath !== filePath),
          };
        }),
      }));
      persistTabs(get().workspaces, workspace.id);
      persistComments(get().workspaces, workspace.id, (message) => set({ saveError: message }));
      void get().rebuildWorkspaceIndex(workspace.id);
    } catch (error) {
      set({ saveError: error instanceof Error ? error.message : "Could not delete file" });
    }
  },
  dismissConflict: (relativePath: string) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
        dismissBufferConflict(item, relativePath),
      ),
    }));
  },
  handleFsEvent: async (workspaceId: string, event: WorkspaceFsEvent) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      return;
    }

    const { workspace: updated, effect } = applyFsEvent(workspace, event);
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspaceId, () => updated),
    }));

    if (effect.type === "reloadFile") {
      try {
        const fileBuffer = await readFileIpc(workspaceId, effect.relativePath);
        set((state) => ({
          workspaces: updateWorkspace(state.workspaces, workspaceId, (item) =>
            applyFileBuffer(item, effect.relativePath, fileBuffer),
          ),
        }));
        void get().rebuildWorkspaceIndex(workspaceId);
      } catch {
        set((state) => ({
          workspaces: updateWorkspace(state.workspaces, workspaceId, (item) =>
            markBufferConflict(item, effect.relativePath),
          ),
        }));
      }
    } else if (effect.type === "rescan") {
      try {
        const entries = await scanWorkspace(workspaceId);
        set((state) => ({
          workspaces: updateWorkspace(state.workspaces, workspaceId, (item) =>
            applyScanResult(item, entries),
          ),
        }));
        persistTabs(get().workspaces, workspaceId);
        persistComments(get().workspaces, workspaceId, (message) => set({ saveError: message }));
        void get().rebuildWorkspaceIndex(workspaceId);
      } catch {
        set((state) => ({
          workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => ({
            ...item,
            scanError: "Workspace rescan failed after filesystem event",
            scanState: "failed",
          })),
        }));
      }
    }
  },
  hydrateWorkspaces: (workspaceList: WorkspaceListResult) => {
    set((state) => {
      const workspaces = hydrateWorkspaceRecords(state.workspaces, workspaceList.workspaces);
      const activeWorkspaceId =
        workspaceList.activeWorkspaceId ?? workspaces[0]?.id ?? state.activeWorkspaceId;

      return {
        activeWorkspaceId,
        onboarding: workspaceList.onboarding,
        workspaces,
      };
    });
  },
  onboarding: {},
  onboardingComplete: () => Boolean(get().onboarding.completedAt),
  setOnboarding: (onboarding: OnboardingState) => {
    set({ onboarding });
  },
  showDashboard: () => {
    set({ viewMode: "dashboard" });
  },
  viewMode: "dashboard",
  loadActiveWorkspaceFiles: async () => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) {
      return;
    }
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspaceId, (item) =>
        item.scanState === "loading" ? item : { ...item, scanState: "loading", scanError: null },
      ),
    }));

    try {
      const entries = await scanWorkspace(workspaceId);
      const comments = await loadWorkspaceComments(workspaceId);
      // Restore the workspace's active conversation (most-recently-OPENED
      // non-archived, non-deleted) so the chat survives reload. Best-effort:
      // a load failure shouldn't block the scan/comments restore.
      const conversation = await loadActiveConversation(workspaceId).catch(() => null);
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => {
          const scanned = applyScanResult({ ...item, comments }, entries);
          return conversation
            ? { ...scanned, chatThread: hydrateChatThread(scanned.chatThread, conversation) }
            : scanned;
        }),
      }));
      persistTabs(get().workspaces, workspaceId);
      // Populate the conversation history list for the panel's switcher.
      void get().loadConversations(workspaceId);

      const refreshed = get().workspaces.find((item) => item.id === workspaceId);
      const activeFilePath = refreshed?.activeFilePath ?? "";
      if (refreshed && activeFilePath && !refreshed.fileContents[activeFilePath]) {
        try {
          const buffer = await readFileIpc(workspaceId, activeFilePath);
          set((state) => ({
            workspaces: updateWorkspace(state.workspaces, workspaceId, (item) =>
              applyFileBuffer(item, activeFilePath, buffer),
            ),
          }));
        } catch {
          set({ saveError: `Could not restore open file: ${activeFilePath}` });
        }
      }
      void get().rebuildWorkspaceIndex(workspaceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workspace scan failed";
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => ({
          ...item,
          scanError: message,
          scanState: "failed",
        })),
      }));
    }
  },
  openChat: () => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    set({ chatOpen: true });
  },
  newChat: async () => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    const thread = workspace.chatThread;
    // Don't start a new chat over a running turn.
    if (thread.activeRunId || thread.runState === "starting" || thread.runState === "streaming") {
      return;
    }
    const workspaceId = workspace.id;
    // Just clear the visible thread to an empty, conversation-less slate.
    // We do NOT touch the DB here — the conversation row is created lazily
    // on the first send (see `sendChatPrompt`), so clicking "New chat"
    // repeatedly never litters history with empty conversations, and the
    // prior conversation is left exactly as it was (not archived).
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => ({
        ...item,
        chatThread: { ...resetChatThread(item.chatThread), conversationId: null },
      })),
    }));
  },
  conversations: {},
  conversationDeleteNotice: null,
  loadConversations: async (workspaceId: string) => {
    // The list always includes archived rows (the UI filters by the
    // `archived` flag), so the history dropdown, All view, and Archived
    // filter all read from one fetch.
    const summaries = await listConversations(workspaceId, true).catch(() => null);
    if (!summaries) {
      return;
    }
    set((state) => ({ conversations: { ...state.conversations, [workspaceId]: summaries } }));
  },
  openConversation: async (conversationId: string) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    const thread = workspace.chatThread;
    // Don't switch out from under a running turn (the run subscription is
    // bound to the live thread).
    if (thread.activeRunId || thread.runState === "starting" || thread.runState === "streaming") {
      return;
    }
    const workspaceId = workspace.id;
    if (thread.conversationId === conversationId) {
      set({ chatOpen: true });
      return;
    }
    // Opening bumps `last_opened_at` server-side, so this conversation
    // becomes the one restored on next load.
    const snapshot = await loadConversation(workspaceId, conversationId).catch(() => null);
    if (!snapshot) {
      return;
    }
    set((state) => ({
      chatOpen: true,
      workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => ({
        ...item,
        chatThread: hydrateChatThread(item.chatThread, snapshot),
      })),
    }));
    void get().loadConversations(workspaceId);
  },
  renameConversation: async (conversationId: string, title: string | null) => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) {
      return;
    }
    const previous = get().conversations[workspaceId] ?? [];
    const trimmed = title?.trim() ? title.trim() : null;
    // Optimistic: show the explicit title immediately. Clearing it (null)
    // keeps the current label until the refresh resolves the derived one.
    set((state) => ({
      conversations: patchConversationList(state.conversations, workspaceId, (list) =>
        list.map((item) =>
          item.conversationId === conversationId
            ? { ...item, title: trimmed ?? item.title }
            : item,
        ),
      ),
    }));
    try {
      await renameConversationIpc(workspaceId, conversationId, title);
      await get().loadConversations(workspaceId);
    } catch {
      set((state) => ({
        conversations: { ...state.conversations, [workspaceId]: previous },
      }));
    }
  },
  archiveConversation: async (conversationId: string, archived: boolean) => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) {
      return;
    }
    const previous = get().conversations[workspaceId] ?? [];
    set((state) => ({
      conversations: patchConversationList(state.conversations, workspaceId, (list) =>
        list.map((item) =>
          item.conversationId === conversationId ? { ...item, archived } : item,
        ),
      ),
    }));
    // Archiving the open conversation just opens the next one.
    const openId = get().activeWorkspace()?.chatThread.conversationId ?? null;
    if (archived && openId === conversationId) {
      await openNextConversationOrReset(get, set, workspaceId, conversationId);
    }
    try {
      await archiveConversationIpc(workspaceId, conversationId, archived);
      await get().loadConversations(workspaceId);
    } catch {
      set((state) => ({
        conversations: { ...state.conversations, [workspaceId]: previous },
      }));
    }
  },
  deleteConversation: (conversationId: string) => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) {
      return;
    }
    const target = (get().conversations[workspaceId] ?? []).find(
      (item) => item.conversationId === conversationId,
    );
    if (!target) {
      return;
    }
    const wasOpen =
      get().activeWorkspace()?.chatThread.conversationId === conversationId;
    // Optimistic: drop it from the list now and surface the undo toast.
    set((state) => ({
      conversations: patchConversationList(state.conversations, workspaceId, (list) =>
        list.filter((item) => item.conversationId !== conversationId),
      ),
      conversationDeleteNotice: { workspaceId, conversationId, title: target.title },
    }));
    if (wasOpen) {
      void openNextConversationOrReset(get, set, workspaceId, conversationId);
    }
    // Commit the soft-delete after the grace window unless undone.
    const key = `${workspaceId}:${conversationId}`;
    const pending = conversationDeleteTimers.get(key);
    if (pending) {
      clearTimeout(pending);
    }
    const timer = setTimeout(() => {
      conversationDeleteTimers.delete(key);
      const notice = get().conversationDeleteNotice;
      if (
        notice &&
        notice.workspaceId === workspaceId &&
        notice.conversationId === conversationId
      ) {
        set({ conversationDeleteNotice: null });
      }
      void deleteConversationIpc(workspaceId, conversationId)
        .catch(() => {})
        .finally(() => {
          void get().loadConversations(workspaceId);
        });
    }, CONVERSATION_DELETE_GRACE_MS);
    conversationDeleteTimers.set(key, timer);
  },
  undoDeleteConversation: (conversationId: string) => {
    const workspaceId =
      get().conversationDeleteNotice?.workspaceId ?? get().activeWorkspaceId;
    if (!workspaceId) {
      return;
    }
    const key = `${workspaceId}:${conversationId}`;
    const timer = conversationDeleteTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      conversationDeleteTimers.delete(key);
    }
    set({ conversationDeleteNotice: null });
    // The delete never committed — reloading restores the row.
    void get().loadConversations(workspaceId);
  },
  duplicateConversation: async (conversationId: string) => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) {
      return;
    }
    try {
      const newId = await duplicateConversationIpc(workspaceId, conversationId);
      await get().loadConversations(workspaceId);
      await get().openConversation(newId);
    } catch {
      void get().loadConversations(workspaceId);
    }
  },
  reloadActiveFile: async () => {
    const workspace = get().activeWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return;
    }
    const filePath = workspace.activeFilePath;
    try {
      const buffer = await readFileIpc(workspace.id, filePath);
      set((state) => ({
        saveError: null,
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
          applyFileBuffer(item, filePath, buffer),
        ),
      }));
      void get().rebuildWorkspaceIndex(workspace.id);
    } catch (error) {
      set({ saveError: error instanceof Error ? error.message : "Could not reload file" });
    }
  },
  rebuildWorkspaceIndex: async (workspaceId?: string) => {
    const targetWorkspaceId = workspaceId ?? get().activeWorkspaceId;
    if (!targetWorkspaceId) {
      return;
    }

    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, targetWorkspaceId, markWorkspaceIndexing),
    }));

    try {
      const snapshot = await rebuildWorkspaceIndexIpc(targetWorkspaceId);
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, targetWorkspaceId, (item) =>
          applyWorkspaceIndexSnapshot(item, snapshot),
        ),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workspace index failed";
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, targetWorkspaceId, (item) =>
          markWorkspaceIndexFailed(item, message),
        ),
      }));
    }
  },
  removeWorkspace: (workspaceId: string) => {
    set((state) => {
      const workspaces = state.workspaces.filter((workspace) => workspace.id !== workspaceId);
      const activeWorkspaceId =
        state.activeWorkspaceId === workspaceId
          ? workspaces[0]?.id ?? null
          : state.activeWorkspaceId;

      return {
        activeWorkspaceId,
        chatOpen: activeWorkspaceId ? state.chatOpen : false,
        workspaces,
      };
    });
  },
  renameActiveFile: async (toRelativePath: string) => {
    const workspace = get().activeWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return;
    }
    const from = workspace.activeFilePath;
    const trimmed = toRelativePath.trim();
    if (!trimmed || trimmed === from) {
      return;
    }

    try {
      await renameFileIpc(workspace.id, from, trimmed);
      set((state) => ({
        saveError: null,
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => {
          const buffer = item.fileContents[from];
          const remainingContents = { ...item.fileContents };
          delete remainingContents[from];
          if (buffer) {
            remainingContents[trimmed] = buffer;
          }
          const files = item.files
            .map((entry) =>
              entry.relativePath === from ? { ...entry, relativePath: trimmed } : entry,
            )
            .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
          const openFilePaths = item.openFilePaths.map((path) =>
            path === from ? trimmed : path,
          );
          const activeFilePath = item.activeFilePath === from ? trimmed : item.activeFilePath;
          const renamed = {
            ...item,
            activeFilePath,
            chatThread: setCurrentTabContext(item.chatThread, item.id, activeFilePath),
            fileContents: remainingContents,
            files,
            openFilePaths,
          };
          return moveWorkspaceComments(renamed, from, trimmed, Date.now());
        }),
      }));
      persistTabs(get().workspaces, workspace.id);
      persistComments(get().workspaces, workspace.id, (message) => set({ saveError: message }));
      void get().rebuildWorkspaceIndex(workspace.id);
    } catch (error) {
      set({ saveError: error instanceof Error ? error.message : "Could not rename file" });
    }
  },
  saveActiveFile: async () => {
    const workspace = get().activeWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return;
    }
    const filePath = workspace.activeFilePath;
    const buffer = workspace.fileContents[filePath];
    if (!buffer) {
      return;
    }

    try {
      const result = await writeFileIpc(
        workspace.id,
        filePath,
        buffer.content,
        buffer.conflict ? null : buffer.lastModifiedMs,
        buffer.pendingChanges,
      );
      set((state) => ({
        saveError: null,
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
          markBufferSaved(item, filePath, result.lastModifiedMs),
        ),
      }));
      void get().rebuildWorkspaceIndex(workspace.id);
    } catch (error) {
      if (error instanceof FileConflictError) {
        set((state) => ({
          saveError: "File changed on disk — reload before saving.",
          workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
            markBufferConflict(item, filePath),
          ),
        }));
        return;
      }
      set({ saveError: error instanceof Error ? error.message : "Save failed" });
    }
  },
  saveError: null,
  sendChatPrompt: async () => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    const thread = workspace.chatThread;
    if (thread.activeRunId || thread.runState === "starting" || thread.runState === "streaming") {
      return;
    }
    const userMessage = thread.prompt.trim();
    if (!userMessage) {
      return;
    }

    // OPTIMISTIC: Render the user message + clear the input + flip
    // the thread into the "starting" runState immediately so the
    // Send button visibly transitions into Stop, AND the
    // re-entrancy guard above catches any double-click that lands
    // before the async IPC checks settle.
    //
    // Previously we only appended the message at this moment.
    // The runState transition happened ~100-300ms later inside
    // `startBobRun`, during which Send stayed clickable — users
    // double-clicked thinking the first click was ignored, queueing
    // a second copy of their message into the chat.
    const workspaceId = workspace.id;
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => ({
        ...item,
        chatThread: {
          ...appendUserChatMessage(item.chatThread, userMessage, null, null),
          runState: "starting" as const,
          runError: null,
        },
      })),
    }));

    // Credential preflight runs only for harnesses Compose manages a
    // key for — driven by capability, not `id === "bob"`. Such a
    // harness can't run without its CLI + key, so we verify up front
    // and fail fast with a precise message rather than spawn a doomed
    // process. Login-managed CLIs (Claude, Codex) have nothing for
    // Compose to check here — a missing login surfaces as *that
    // harness's* run error, not a misleading "Connect your Bob API
    // key". Same gate as ChatPanel.
    const harnessId = get().selectedHarnessId;
    if (harnessCapabilitiesOf(get().harnessCatalog, harnessId).credentialRequired) {
      const [authStatus, installStatus] = await Promise.all([
        getBobAuthStatus().catch((error) => ({
          configured: false,
          errorMessage: errorMessage(error, "Could not verify Bob credentials"),
        })),
        checkBobInstall().catch((error) => ({
          errorMessage: errorMessage(error, "Could not verify Bob CLI"),
          installed: false,
        })),
      ]);
      set({ bobAuthStatus: authStatus, bobInstallStatus: installStatus });
      const readiness = bobRuntimeReadiness(authStatus, installStatus);
      if (!readiness.ready) {
        set((state) => ({
          workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => ({
            ...item,
            chatThread: {
              ...item.chatThread,
              runError: readiness.message,
              runState: "error",
            },
          })),
        }));
        return;
      }
    }
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // `thread` is the pre-append snapshot, so `thread.messages` are the
    // *prior* turns — replay them into the prompt for harness-neutral
    // continuity (the agent "remembers" the conversation). Trace excluded.
    const promptWithContext = createPromptWithContext(
      userMessage,
      thread.contextItems,
      thread.messages,
    );
    const contextFilePaths = thread.contextItems
      .filter((item) => item.kind === "file")
      .map((item) => item.path);

    // Ensure the thread maps to a persisted conversation, then save the
    // just-appended user message (so a mid-stream crash keeps the
    // question). Lazily create the conversation on first send.
    let conversationId = thread.conversationId;
    if (!conversationId) {
      conversationId = await newConversation(workspaceId, harnessId).catch(() => null);
      if (conversationId) {
        const id = conversationId;
        set((state) => ({
          workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => ({
            ...item,
            chatThread: { ...item.chatThread, conversationId: id },
          })),
        }));
      }
    }
    persistConversation(get, workspaceId);

    // Batched setter — folds all stream-driven state changes for
    // this run into one set() per animation frame. See
    // createBatchedRunSetter for the rationale.
    const batched = createBatchedRunSetter(set, workspaceId);
    const updateThread = batched.updateThread;
    const updateWorkspaceForRun = batched.updateWorkspaceForRun;

    let releaseSubscription: (() => void) | null = null;
    let llmThreadId: string | null = null;
    let completionPersisted = false;
    const finalize = (options: FinalizeBobRunOptions) => {
      // Flush queued stream events synchronously so persistedRunBody
      // sees every token. Then queue the terminal finalize updater
      // and flush again so it lands in the same tick — no dangling
      // rAF after dispose.
      batched.flushNow();
      const currentThread =
        get().workspaces.find((item) => item.id === workspaceId)?.chatThread ?? null;
      const persisted = currentThread ? persistedRunBody(currentThread, runId, options) : null;
      if (llmThreadId && persisted && !completionPersisted) {
        completionPersisted = true;
        void appendLlmMessage({
          body: persisted.body,
          llmThreadId,
          role: persisted.role,
          workspaceId,
        }).catch((error) => {
          set({ saveError: errorMessage(error, "Could not persist Bob response") });
        });
      }
      updateThread((current) => finalizeBobRun(current, runId, options));
      batched.flushNow();
      batched.dispose();
      // Turn settled — persist the final answer (+ its trace + stats).
      persistConversation(get, workspaceId);
      if (releaseSubscription) {
        releaseSubscription();
        releaseSubscription = null;
        activeRunSubscriptions.delete(runId);
      }
    };

    try {
      const persistedThread = await recordLlmThread({
        contextItems: createLlmContextSnapshots(thread.contextItems),
        prompt: userMessage,
        workspaceId,
      });
      llmThreadId = persistedThread.llmThreadId;

      // User message was already appended optimistically above. We
      // patch the existing message with `llmThreadId` (which was
      // unknown at optimistic-render time) so context-audit tooling
      // can correlate it back to the persisted LLM thread.
      updateThread((current) => {
        const messages = current.messages.map((message, idx) =>
          idx === current.messages.length - 1
          && message.role === "user"
          && message.content === userMessage
          && !message.llmThreadId
            ? { ...message, llmThreadId: llmThreadId ?? undefined }
            : message,
        );
        return startBobRun({ ...current, messages }, runId, llmThreadId);
      });

      // Resolve the run's capabilities + tuning + edit-review mode up front so
      // the subscription's terminal hook (post-run diff) can close over it.
      const capabilities = harnessCapabilitiesOf(get().harnessCatalog, harnessId);
      const tuning = get().harnessOptions[harnessId] ?? {};
      const editGuard = editGuardFor(capabilities, get().allowEdits, tuning);

      releaseSubscription = await subscribeHarnessRun(runId, (event) => {
        handleHarnessRunEvent(event, runId, updateWorkspaceForRun, finalize, ({ cancelled }) => {
          void finishReviewRun(set, workspaceId, runId, editGuard, cancelled);
        });
      });
      activeRunSubscriptions.set(runId, releaseSubscription);

      // Route to the user's selected harness (resolved above, before
      // the preflight). A harness that previews edits (bob) keeps the
      // "plan" mode — the user approves its proposed edits, so the
      // allow-edits toggle is moot. Direct-edit harnesses (claude/codex)
      // map the toggle onto the run mode: allow → "code" (Edit),
      // otherwise "plan" (Ask). Capability-driven, not `id === "bob"`.
      const chatMode = capabilities.previewsEdits
        ? "plan"
        : get().allowEdits
          ? "code"
          : "plan";
      await runHarnessStream({
        approvalMode: "default",
        chatMode,
        contextFilePaths,
        maxCoins: 200,
        prompt: promptWithContext,
        runId,
        workspaceId,
        harnessId,
        model: tuning.model,
        effort: tuning.effort,
        maxTurns: tuning.maxTurns,
        editGuard,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The assistant could not start";
      const currentThread =
        get().workspaces.find((item) => item.id === workspaceId)?.chatThread ?? null;
      if (currentThread?.activeRunId === runId) {
        finalize({ errorMessage: message });
      } else {
        // The run never started — no streaming events to drain, but
        // still flush + dispose so the error state lands in this tick
        // and the batcher doesn't leak a pending rAF.
        updateThread((current) => ({ ...current, runError: message, runState: "error" }));
        batched.flushNow();
        batched.dispose();
        if (releaseSubscription) {
          releaseSubscription();
          activeRunSubscriptions.delete(runId);
        }
      }
    }
  },
  askBobAboutSelectionStream: async (question, selection) => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      return;
    }
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    const thread = workspace.chatThread;
    // Re-entrancy guard — match sendChatPrompt's behaviour.
    if (
      thread.activeRunId
      || thread.runState === "starting"
      || thread.runState === "streaming"
    ) {
      return;
    }

    // Credential preflight, exactly as in `sendChatPrompt` and driven
    // by capability rather than `id === "bob"`. A Compose-managed-key
    // harness can't run without its CLI + key, so we surface the
    // precise "connect" guidance (and open Settings so the user can fix
    // it in place) rather than spawn a doomed run. Login-managed CLIs
    // (Claude, Codex) have nothing for Compose to check — a missing
    // login surfaces as *that harness's* run error.
    const harnessId = get().selectedHarnessId;
    if (harnessCapabilitiesOf(get().harnessCatalog, harnessId).credentialRequired) {
      const readiness = bobRuntimeReadiness(get().bobAuthStatus, get().bobInstallStatus);
      if (!readiness.ready) {
        // Surface the error in chat and open Settings as a pane so the user
        // can self-serve the fix (we're in a workspace here, so it's a tab).
        set((state) => ({
          chatOpen: true,
          workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
            openWorkspacePane(
              {
                ...item,
                chatThread: {
                  ...item.chatThread,
                  runError: readiness.message ?? "Bob isn't connected yet.",
                  runState: "error",
                },
              },
              { id: "settings", kind: "settings", title: "Settings" },
            ),
          ),
        }));
        return;
      }
    }

    const workspaceId = workspace.id;
    const runId = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Build the user-visible chat message: quoted selection + question.
    // The same string is what the harness sees, so the model has the
    // excerpt inline rather than via some side-channel context packet.
    const filePath = workspace.activeFilePath || "the current note";
    const quotedSelection = selection.text
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const userMessage =
      `About this excerpt from \`${filePath}\`:\n\n${quotedSelection}\n\n${trimmedQuestion}`;

    // Batched setter (one set() per animation frame) so per-token
    // deltas don't saturate React. finalize() flushes + disposes at the
    // tail of the stream (terminal event) or in the catch path.
    const batched = createBatchedRunSetter(set, workspaceId);
    const updateThread = batched.updateThread;
    const updateWorkspaceForRun = batched.updateWorkspaceForRun;

    let releaseSubscription: (() => void) | null = null;
    const finalize = (options: FinalizeBobRunOptions) => {
      batched.flushNow();
      updateThread((current) => finalizeBobRun(current, runId, options));
      batched.flushNow();
      batched.dispose();
      // Turn settled — persist the final answer (+ its trace + stats).
      persistConversation(get, workspaceId);
      if (releaseSubscription) {
        releaseSubscription();
        releaseSubscription = null;
        activeRunSubscriptions.delete(runId);
      }
    };

    // Open chat, append user message, start the run.
    set((state) => ({
      chatOpen: true,
      workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => ({
        ...item,
        chatThread: startBobRun(
          appendUserChatMessage(item.chatThread, userMessage, null, null),
          runId,
          null,
        ),
      })),
    }));

    // Ensure a persisted conversation + save the question (same as the
    // main send path).
    const existingConversationId = workspace.chatThread.conversationId;
    if (!existingConversationId) {
      const created = await newConversation(workspaceId, harnessId).catch(() => null);
      if (created) {
        set((state) => ({
          workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => ({
            ...item,
            chatThread: { ...item.chatThread, conversationId: created },
          })),
        }));
      }
    }
    persistConversation(get, workspaceId);

    try {
      releaseSubscription = await subscribeHarnessRun(runId, (event) => {
        handleHarnessRunEvent(event, runId, updateWorkspaceForRun, finalize);
      });
      activeRunSubscriptions.set(runId, releaseSubscription);

      // Route through the user's selected harness (resolved above,
      // before the preflight) — `run_harness_stream` keeps bob on its
      // richer Tauri path and dispatches every other id through
      // `run_via_harness`. "ask" is read-only for every harness: bob's
      // `--chat-mode ask`, and `RunMode::Ask` for the CLI harnesses.
      // A question about a selection never edits the file, so the
      // allow-edits toggle is deliberately not consulted here.
      const tuning = get().harnessOptions[harnessId] ?? {};
      await runHarnessStream({
        approvalMode: "default",
        chatMode: "ask",
        maxCoins: 30,
        prompt: userMessage,
        runId,
        workspaceId,
        harnessId,
        model: tuning.model,
        effort: tuning.effort,
        maxTurns: tuning.maxTurns,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The assistant could not start";
      const currentThread =
        get().workspaces.find((item) => item.id === workspaceId)?.chatThread ?? null;
      if (currentThread?.activeRunId === runId) {
        finalize({ errorMessage: message });
      } else {
        // The run never started — no streaming events to drain, but
        // still flush + dispose so the error state lands in this tick
        // and the batcher doesn't leak a pending rAF.
        updateThread((current) => ({ ...current, runError: message, runState: "error" }));
        batched.flushNow();
        batched.dispose();
        if (releaseSubscription) {
          releaseSubscription();
          activeRunSubscriptions.delete(runId);
        }
      }
    }
  },
  sendCommentToChat: async (commentId: string) => {
    const workspace = get().activeWorkspace();
    const comment = workspace?.comments.find((item) => item.id === commentId);
    if (!workspace || !comment) {
      return;
    }

    set((state) => ({
      chatOpen: true,
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => ({
        ...item,
        activeFilePath: comment.filePath,
        chatThread: {
          ...setCommentChatContext(item.chatThread, item.id, comment),
          prompt: comment.body || "Help me with this selection.",
        },
        openFilePaths: item.openFilePaths.includes(comment.filePath)
          ? item.openFilePaths
          : [...item.openFilePaths, comment.filePath],
      })),
    }));

    await get().sendChatPrompt();
  },
  selectFile: async (path: string) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }

    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
        openWorkspaceFile(item, path),
      ),
    }));
    persistTabs(get().workspaces, workspace.id);

    const current = get().workspaces.find((item) => item.id === workspace.id);
    if (current && current.fileContents[path]) {
      return;
    }

    try {
      const buffer = await readFileIpc(workspace.id, path);
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
          applyFileBuffer(item, path, buffer),
        ),
      }));
    } catch (error) {
      set({ saveError: error instanceof Error ? error.message : "Could not open file" });
    }
  },
  rejectSuggestedEdit: (suggestionId: string) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    const suggestion = findWorkspaceSuggestion(workspace, suggestionId);

    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
        rejectWorkspaceSuggestion(item, suggestionId, Date.now()),
      ),
    }));
    // Discarding the last pending change of a reviewed run retires its sandbox.
    if (suggestion && suggestion.kind !== "replace") {
      maybeCleanupReview(get, workspace.id, suggestion.runId);
    }
  },
  setBobAuthStatus: (status: BobAuthStatus) => {
    set({ bobAuthStatus: status });
  },
  setBobInstallStatus: (status: BobInstallStatus | null) => {
    set({ bobInstallStatus: status });
  },
  setChatPrompt: (prompt: string) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }

    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => ({
        ...item,
        chatThread: {
          ...item.chatThread,
          preparedCommand: null,
          prompt,
        },
      })),
    }));
  },
  setupComplete: () => isSetupComplete(get().bobAuthStatus, get().workspaces),
  settingsOpen: false,
  openSettings: () => {
    const workspace = get().activeWorkspace();
    if (workspace) {
      // In a workspace, Settings opens as a tab in the pane strip.
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
          openWorkspacePane(item, { id: "settings", kind: "settings", title: "Settings" }),
        ),
      }));
      return;
    }
    // No workspace (dashboard) — there's no tab strip, so use the modal.
    set({ settingsOpen: true });
  },
  closeSettings: () => set({ settingsOpen: false }),
  openPane: (pane: WorkspacePane) => {
    const workspace = get().activeWorkspace();
    if (!workspace) return;
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
        openWorkspacePane(item, pane),
      ),
    }));
  },
  closePane: (paneId: string) => {
    const workspace = get().activeWorkspace();
    if (!workspace) return;
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
        closeWorkspacePane(item, paneId),
      ),
    }));
  },
  selectPane: (paneId: string) => {
    const workspace = get().activeWorkspace();
    if (!workspace) return;
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
        item.openPanes.some((pane) => pane.id === paneId)
          ? { ...item, activePaneId: paneId }
          : item,
      ),
    }));
  },
  selectedHarnessId: INITIAL_HARNESS_PREFS.selectedHarnessId,
  allowEdits: INITIAL_HARNESS_PREFS.allowEdits,
  harnessOptions: INITIAL_HARNESS_PREFS.harnessOptions,
  setSelectedHarness: (harnessId: string) => {
    set({ selectedHarnessId: harnessId });
    persistHarnessPrefs({
      selectedHarnessId: harnessId,
      allowEdits: get().allowEdits,
      harnessOptions: get().harnessOptions,
    });
  },
  setAllowEdits: (allow: boolean) => {
    set({ allowEdits: allow });
    persistHarnessPrefs({
      selectedHarnessId: get().selectedHarnessId,
      allowEdits: allow,
      harnessOptions: get().harnessOptions,
    });
  },
  setHarnessOptions: (harnessId: string, options: Partial<HarnessRunOptions>) => {
    set((state) => ({
      harnessOptions: {
        ...state.harnessOptions,
        [harnessId]: { ...state.harnessOptions[harnessId], ...options },
      },
    }));
    persistHarnessPrefs({
      selectedHarnessId: get().selectedHarnessId,
      allowEdits: get().allowEdits,
      harnessOptions: get().harnessOptions,
    });
  },
  harnessCatalog: [],
  loadHarnessCatalog: async () => {
    // Best-effort: the registry is desktop-only, so this resolves to []
    // in the browser preview (the static fallback in
    // `harnessCapabilitiesOf` covers that). Never throws into bootstrap.
    const catalog = await harnessList().catch(() => [] as HarnessInfo[]);
    set({ harnessCatalog: catalog });
  },
  switchWorkspace: (workspaceId: string) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      return;
    }

    const nowMs = Date.now();
    set((state) => ({
      activeWorkspaceId: workspace.id,
      viewMode: "workspace",
      workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => ({
        ...item,
        lastOpenedAt: nowMs,
      })),
    }));
    void markWorkspaceOpened(workspaceId).catch(() => undefined);
  },
  toggleChat: () => {
    if (get().chatOpen) {
      set({ chatOpen: false });
      return;
    }

    get().openChat();
  },
  updateActiveContent: (markdown: string, changes: DocumentTextChange[] = []) => {
    const workspace = get().activeWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return;
    }

    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
        applyWorkspaceDocumentChanges(
          item,
          item.activeFilePath,
          markdown,
          changes,
          Date.now(),
        ),
      ),
    }));
    if (changes.length > 0) {
      persistComments(get().workspaces, workspace.id, (message) => set({ saveError: message }));
    }
  },
  workspaces: [],
}));
