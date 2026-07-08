import type { WorkspaceStoreGet, WorkspaceStoreSet } from "./types";
import { showErrorToast, showToast } from "../../features/toast/toastStore";
import { basename } from "../../lib/workspace/displayPath";
import { formatHarnessError } from "../../lib/format/harnessError";
import { useUiStore } from "./uiStore";
import { useHarnessStore } from "./harnessStore";
import {
  activeRunSubscriptions,
  createBatchedRunSetter,
  handleHarnessRunEvent,
  persistedRunBody,
} from "./runEvents";
import {
  appendLlmMessage,
  recordLlmThread,
} from "../../lib/ipc/llmContextClient";
import {
  appendUserChatMessage,
  createLlmContextSnapshots,
  createPromptWithContext,
  finalizeRun,
  missingFileContextPaths,
  startRun,
  type FinalizeRunOptions,
} from "../workspaceModel";
import {
  beginAgentEditWindow,
  endAgentEditWindow,
} from "../agentEditWindow";
import {
  editGuardFor,
  harnessCapabilitiesOf,
  harnessExtraArgs,
} from "./harnessConfig";
import {
  errorMessage,
  prefixWorkspaceContext,
  updateWorkspace,
} from "./internals";
import {
  finishReviewRun,
} from "./reviewFlow";
import {
} from "../../lib/ipc/conversationsClient";
import {
  persistConversation,
} from "./persistence";
import {
  createRunPersister,
} from "./runPersist";
import {
  playCompletionChime,
} from "../../lib/audio/completionChime";
import {
  harnessCredentialStatus,
  runHarnessStream,
  subscribeHarnessRun,
} from "../../lib/ipc/harnessClient";
import {
  spillChatInputForPrompt,
} from "./chatInputSpill";
import {
  collectFileContextContent,
} from "./fileContextContent";

/**
 * Run a chat-send turn: optimistic user message, credential preflight, then
 * stream the harness reply into the active thread. Extracted from the chat slice
 * (see chatSlice.ts `sendChatPrompt`).
 */
export async function runSendChatPrompt(
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
  options?: { readOnly?: boolean },
): Promise<void> {
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
  // `startRun`, during which Send stayed clickable — users
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
  // harness can't run without its stored key, so we verify it up
  // front via the generic keychain check and fail fast with a
  // precise message rather than spawn a doomed process. Login-managed
  // CLIs (Claude, Codex) have nothing for Compose to check here — a
  // missing login surfaces as *that harness's* run error, not a
  // misleading "Connect your Bob API key". Same gate as ChatPanel.
  const { selectedHarnessId: harnessId, harnessCatalog } = useHarnessStore.getState();
  // No agent set up yet (first run, nothing ready) — AI is off until one is added.
  if (!harnessId) {
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => ({
        ...item,
        chatThread: {
          ...item.chatThread,
          runError: "Set up an AI agent in Settings to start chatting.",
          runState: "error",
        },
      })),
    }));
    return;
  }
  if (harnessCapabilitiesOf(harnessCatalog, harnessId).credentialRequired) {
    const info = harnessCatalog.find((entry) => entry.id === harnessId);
    const status = await harnessCredentialStatus(harnessId).catch(() => ({ configured: false }));
    if (!status.configured) {
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => ({
          ...item,
          chatThread: {
            ...item.chatThread,
            runError: `Add your ${info?.displayName ?? harnessId} API key in Settings to use it.`,
            runState: "error",
          },
        })),
      }));
      return;
    }
  }
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // A very large paste is spilled to a scratch file and replaced — in the *sent*
  // prompt only — with a short reference the model reads on demand, so it can't
  // blow a small context window in turn one. The chat-visible message (appended
  // optimistically above) stays the full original text.
  const sentUserMessage = await spillChatInputForPrompt(workspaceId, userMessage);
  const contextFilePaths = thread.contextItems
    .filter((item) => item.kind === "file")
    .map((item) => item.path);
  // A context file that's gone from the tree (external delete, sync eviction)
  // still sends as a path reference — the harness self-heals a failed read —
  // but the degradation shouldn't be silent. Gated on a ready scan so a
  // mid-boot load can't false-alarm.
  if (workspace.scanState === "ready") {
    const looseFiles =
      get().workspaces.find((item) => item.kind === "loose")?.files ?? [];
    const missing = missingFileContextPaths(thread.contextItems, workspace.files, looseFiles);
    if (missing.length > 0) {
      const names = missing.map(basename).join(", ");
      showToast({
        kind: "info",
        title: missing.length === 1 ? "Context file missing" : "Context files missing",
        message: `${names} ${missing.length === 1 ? "isn't" : "aren't"} on disk right now — sent as a reference.`,
      });
    }
  }
  // Tool-native CLI agents (claude/codex/bob) read context files on demand via
  // their own tools, so we send a PATH REFERENCE — keeping the prompt small,
  // current, and cache-stable rather than inlining a snapshot. The openai-
  // compatible adapter (Ollama / OpenRouter, capability `supportsCustomInstructions`)
  // gets the file CONTENT inlined (budgeted), since a weak local model may not
  // reliably read on its own. Only that path needs the IO.
  const inlineContext = harnessCapabilitiesOf(harnessCatalog, harnessId).supportsCustomInstructions;
  const fileContextContent = inlineContext
    ? await collectFileContextContent(
        workspace,
        contextFilePaths,
        get().workspaces.find((item) => item.kind === "loose") ?? null,
      )
    : new Map<string, string>();
  // `thread` is the pre-append snapshot, so `thread.messages` are the
  // *prior* turns — replay them into the prompt for harness-neutral
  // continuity (the agent "remembers" the conversation). Trace excluded.
  const promptWithContext = createPromptWithContext(
    sentUserMessage,
    thread.contextItems,
    thread.messages,
    fileContextContent,
    inlineContext,
  );

  // Map the thread to a persisted conversation. The id is generated client-side
  // and the row is created by the first `saveConversation` upsert below — there's
  // no separate "create empty row" step that could strand a 0-message "zombie"
  // (hidden from history) if the message-save didn't follow.
  let conversationId = thread.conversationId;
  if (!conversationId) {
    const id = crypto.randomUUID();
    conversationId = id;
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => ({
        ...item,
        chatThread: { ...item.chatThread, conversationId: id },
      })),
    }));
  }
  // Awaited so the first message is committed before the run (and before the
  // concurrent LLM-thread write), not racing it fire-and-forget.
  await persistConversation(get, workspaceId);

  // Batched setter — folds all stream-driven state changes for
  // this run into one set() per animation frame. See
  // createBatchedRunSetter for the rationale.
  const batched = createBatchedRunSetter(set, workspaceId);
  const updateThread = batched.updateThread;
  const updateWorkspaceForRun = batched.updateWorkspaceForRun;

  // Throttled incremental saves so a crash mid-stream keeps the partial reply
  // (and the interrupted marker). Pinged on every event; disposed on the
  // terminal event.
  const persister = createRunPersister(get, workspaceId);

  let releaseSubscription: (() => void) | null = null;
  let llmThreadId: string | null = null;
  let completionPersisted = false;
  // Set when a snapshot-mode run opens the agent-edit window (below); closed
  // here on the run's terminal event so the window can't leak on error.
  let agentEditWindowOpen = false;
  const finalize = (options: FinalizeRunOptions) => {
    if (agentEditWindowOpen) {
      agentEditWindowOpen = false;
      endAgentEditWindow(workspaceId);
    }
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
        showErrorToast(errorMessage(error, "Could not save the assistant's response"));
      });
    }
    updateThread((current) => finalizeRun(current, runId, options));
    batched.flushNow();
    batched.dispose();
    persister.dispose();
    // Turn settled — persist the final answer (+ its trace + stats), now with
    // `streaming` cleared so the interrupted marker is gone and the history
    // list refreshes.
    void persistConversation(get, workspaceId);
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
      return startRun({ ...current, messages }, runId, llmThreadId);
    });

    // Resolve the run's capabilities + tuning + edit-review mode up front so
    // the subscription's terminal hook (post-run diff) can close over it.
    const capabilities = harnessCapabilitiesOf(useHarnessStore.getState().harnessCatalog, harnessId);
    const tuning = useHarnessStore.getState().harnessOptions[harnessId] ?? {};
    // A read-only send (the "Summarize" / "Key points" suggestions) runs in Ask
    // mode with no edit guard — the harness then refuses any write tool call —
    // so a read-only ask can't write, whatever the global Auto-apply toggle is.
    const allowEdits = options?.readOnly ? false : useHarnessStore.getState().allowEdits;
    const editGuard = editGuardFor(capabilities, allowEdits, useHarnessStore.getState().reviewEdits);

    // Snapshot mode edits the user's real files mid-run; open the agent-edit
    // window so the file watcher attributes those changes to this run (and
    // auto-reloads instead of conflicting). Closed on the run's terminal
    // event (`finalize`, which fires on exit/error/cancel) — idempotent, so
    // the trailing `exited` after an `error` won't double-close.
    if (editGuard === "snapshot") {
      beginAgentEditWindow(workspaceId);
      agentEditWindowOpen = true;
    }

    releaseSubscription = await subscribeHarnessRun(runId, (event) => {
      persister.noteEvent();
      handleHarnessRunEvent(event, runId, updateWorkspaceForRun, finalize, ({ cancelled }) => {
        if (!cancelled && useUiStore.getState().soundOnComplete) {
          void playCompletionChime();
        }
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
    const chatMode = capabilities.previewsEdits ? "plan" : allowEdits ? "code" : "plan";
    // "Currently viewing" follows the EDITOR's focus (#113): an external file's
    // path is already absolute, so no workspace-root join — pointing the agent
    // at the workspace's background active file instead sends it off to read
    // (and answer about) a document the user isn't even looking at.
    const focused = get().focusedWorkspace();
    const viewingLoose = focused?.kind === "loose";
    await runHarnessStream({
      approvalMode: "default",
      chatMode,
      contextFilePaths,
      maxCoins: 200,
      prompt: prefixWorkspaceContext(
        promptWithContext,
        viewingLoose ? undefined : workspace.path,
        focused?.activeFilePath ?? workspace.activeFilePath,
      ),
      runId,
      workspaceId,
      harnessId,
      model: tuning.model,
      effort: tuning.effort,
      maxTurns: tuning.maxTurns,
      editGuard,
      extraArgs: harnessExtraArgs(harnessId, tuning),
      extraInstructions: useHarnessStore.getState().customInstructions || undefined,
      binaryPath: tuning.binaryPath,
    });
  } catch (error) {
    const message = formatHarnessError(error);
    const currentThread =
      get().workspaces.find((item) => item.id === workspaceId)?.chatThread ?? null;
    if (currentThread?.activeRunId === runId) {
      finalize({ errorMessage: message });
    } else {
      // The run never started — no streaming events to drain, but
      // still flush + dispose so the error state lands in this tick
      // and the batcher doesn't leak a pending rAF.
      if (agentEditWindowOpen) {
        agentEditWindowOpen = false;
        endAgentEditWindow(workspaceId);
      }
      updateThread((current) => ({ ...current, runError: message, runState: "error" }));
      batched.flushNow();
      batched.dispose();
      persister.dispose();
      if (releaseSubscription) {
        releaseSubscription();
        activeRunSubscriptions.delete(runId);
      }
    }
  }
}
