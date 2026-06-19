import type { WorkspaceStoreGet, WorkspaceStoreSet } from "./types";
import { showErrorToast } from "../../features/toast/toastStore";
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
  newConversation,
} from "../../lib/ipc/conversationsClient";
import {
  persistConversation,
} from "./persistence";
import {
  playCompletionChime,
} from "../../lib/audio/completionChime";
import {
  harnessCredentialStatus,
  runHarnessStream,
  subscribeHarnessRun,
} from "../../lib/ipc/harnessClient";

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
    const editGuard = editGuardFor(capabilities, allowEdits, tuning);

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
    await runHarnessStream({
      approvalMode: "default",
      chatMode,
      contextFilePaths,
      maxCoins: 200,
      prompt: prefixWorkspaceContext(promptWithContext, workspace.path, workspace.activeFilePath),
      runId,
      workspaceId,
      harnessId,
      model: tuning.model,
      effort: tuning.effort,
      maxTurns: tuning.maxTurns,
      editGuard,
      extraArgs: harnessExtraArgs(harnessId, tuning),
    });
  } catch (error) {
    const message = formatHarnessError(
      error instanceof Error ? error.message : "The assistant could not start",
    );
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
      if (releaseSubscription) {
        releaseSubscription();
        activeRunSubscriptions.delete(runId);
      }
    }
  }
}
