import type { WorkspaceStoreGet, WorkspaceStoreSet } from "./types";
import { useUiStore } from "./uiStore";
import { useHarnessStore } from "./harnessStore";
import {
  activeRunSubscriptions,
  createBatchedRunSetter,
  handleHarnessRunEvent,
} from "./runEvents";
import {
  appendUserChatMessage,
  bobRuntimeReadiness,
  finalizeRun,
  startRun,
  type ChatExcerptRef,
  type FinalizeRunOptions,
  type SourceRange,
} from "../workspaceModel";
import {
  beginAgentEditWindow,
  endAgentEditWindow,
} from "../agentEditWindow";
import {
  byteOffsetToLineColumn,
} from "../../features/text/positionMapper";
import {
  editGuardFor,
  harnessCapabilitiesOf,
  harnessExtraArgs,
} from "./harnessConfig";
import {
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
  runHarnessStream,
  subscribeHarnessRun,
} from "../../lib/ipc/harnessClient";

/**
 * Run a "chat about this selection" turn: open chat, append the quoted excerpt
 * + question as the user message, and stream the harness reply into the thread.
 * Extracted from the chat slice (see chatSlice.ts `askAboutSelectionStream`).
 */
export async function runAskAboutSelection(
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
  question: string,
  selection: { range: SourceRange; text: string },
): Promise<void> {
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
  const harnessId = useHarnessStore.getState().selectedHarnessId;
  if (harnessCapabilitiesOf(useHarnessStore.getState().harnessCatalog, harnessId).credentialRequired) {
    const readiness = bobRuntimeReadiness(useHarnessStore.getState().bobAuthStatus, useHarnessStore.getState().bobInstallStatus);
    if (!readiness.ready) {
      // Surface the error in chat and open the Settings modal so the user
      // can self-serve the fix in place.
      useUiStore.setState({ chatOpen: true, settingsOpen: true });
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => ({
          ...item,
          chatThread: {
            ...item.chatThread,
            runError: readiness.message ?? "The assistant isn't connected yet.",
            runState: "error",
          },
        })),
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

  // The chat renders this message as a chip (file + line:col + excerpt + note)
  // via the `excerpt` metadata; `userMessage` above stays the model's prompt.
  const fileContent = workspace.activeFilePath
    ? (workspace.fileContents[workspace.activeFilePath]?.content ?? "")
    : "";
  const lineColumn = byteOffsetToLineColumn(fileContent, selection.range.start);
  const excerpt: ChatExcerptRef | null = workspace.activeFilePath
    ? {
        filePath: workspace.activeFilePath,
        line: lineColumn.line,
        column: lineColumn.column,
        text: selection.text,
        note: trimmedQuestion,
      }
    : null;

  // Batched setter (one set() per animation frame) so per-token
  // deltas don't saturate React. finalize() flushes + disposes at the
  // tail of the stream (terminal event) or in the catch path.
  const batched = createBatchedRunSetter(set, workspaceId);
  const updateThread = batched.updateThread;
  const updateWorkspaceForRun = batched.updateWorkspaceForRun;

  let releaseSubscription: (() => void) | null = null;
  // Set when a snapshot-mode run opens the agent-edit window (below); closed
  // on the terminal event so it can't leak on error.
  let agentEditWindowOpen = false;
  const finalize = (options: FinalizeRunOptions) => {
    if (agentEditWindowOpen) {
      agentEditWindowOpen = false;
      endAgentEditWindow(workspaceId);
    }
    batched.flushNow();
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

  // Open chat, append user message, start the run.
  useUiStore.getState().openChat();
  set((state) => ({
    workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => ({
      ...item,
      chatThread: startRun(
        appendUserChatMessage(item.chatThread, userMessage, null, null, excerpt),
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
    // The note decides intent — the assistant may answer OR edit based on
    // what you wrote — so the run respects the allow-edits toggle + the edit
    // guard, exactly like a normal chat send (not the old read-only "ask").
    const capabilities = harnessCapabilitiesOf(useHarnessStore.getState().harnessCatalog, harnessId);
    const tuning = useHarnessStore.getState().harnessOptions[harnessId] ?? {};
    const editGuard = editGuardFor(capabilities, useHarnessStore.getState().allowEdits, tuning);
    const chatMode = capabilities.previewsEdits ? "plan" : useHarnessStore.getState().allowEdits ? "code" : "plan";

    // Snapshot mode edits real files mid-run — attribute the watcher's events
    // to this run so they auto-reload instead of conflicting (see the main
    // send path + `agentEditWindow.ts`).
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

    await runHarnessStream({
      approvalMode: "default",
      chatMode,
      maxCoins: 30,
      prompt: prefixWorkspaceContext(userMessage, workspace.path, workspace.activeFilePath),
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
    const message = error instanceof Error ? error.message : "The assistant could not start";
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
