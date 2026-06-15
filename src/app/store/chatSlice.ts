import type { WorkspaceState, WorkspaceStoreGet, WorkspaceStoreSet } from "./types";
import { showErrorToast } from "../../features/toast/toastStore";
import {
  acceptWorkspaceSuggestion,
  appendUserChatMessage,
  finalizeRun,
  rejectWorkspaceSuggestion,
} from "../workspaceModel";
import {
  applyFileReviewChange,
  findWorkspaceSuggestion,
  maybeCleanupReview,
} from "./reviewFlow";
import {
  cancelHarnessRun as cancelHarnessRunIpc,
} from "../../lib/ipc/harnessClient";
import {
  updateWorkspace,
} from "./internals";
import {
  persistComments,
} from "./persistence";
import {
  runAskAboutSelection,
} from "./chatAskSelection";
import {
  runSendChatPrompt,
} from "./chatSend";
import {
  unsubscribeRun,
} from "./runEvents";

export const createChatSlice = (
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
): Pick<WorkspaceState, "appendUserChatMessage" | "acceptSuggestedEdit" | "rejectSuggestedEdit" | "askAboutSelectionStream" | "cancelActiveRun" | "regenerateLastTurn" | "sendChatPrompt" | "setChatPrompt"> => ({
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
    persistComments(get().workspaces, workspace.id, showErrorToast);
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
  askAboutSelectionStream: (question, selection) =>
    runAskAboutSelection(set, get, question, selection),
  cancelActiveRun: async () => {
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
          chatThread: finalizeRun(item.chatThread, runId, { errorMessage: message }),
        })),
      }));
      unsubscribeRun(runId);
    }
  },
  regenerateLastTurn: async () => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    const thread = workspace.chatThread;
    // Don't regenerate over a running turn — symmetric to sendChatPrompt.
    if (
      thread.activeRunId
      || thread.runState === "starting"
      || thread.runState === "streaming"
    ) {
      return;
    }
    // Walk back to find the most recent user message.
    let userText: string | null = null;
    for (let i = thread.messages.length - 1; i >= 0; i -= 1) {
      const message = thread.messages[i];
      if (message.role === "user" && message.content?.trim()) {
        userText = message.content;
        break;
      }
    }
    if (!userText) {
      return;
    }
    // Stage the prompt and delegate to the standard send path. The previous
    // assistant reply stays in history; the regen lands as a fresh turn.
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => ({
        ...item,
        chatThread: {
          ...item.chatThread,
          preparedCommand: null,
          prompt: userText ?? "",
        },
      })),
    }));
    await get().sendChatPrompt();
  },
  sendChatPrompt: () => runSendChatPrompt(set, get),
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
});
