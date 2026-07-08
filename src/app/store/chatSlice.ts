import type { WorkspaceState, WorkspaceStoreGet, WorkspaceStoreSet } from "./types";
import { showErrorToast } from "../../features/toast/toastStore";
import {
  acceptWorkspaceSuggestion,
  addFileContextItem,
  appendUserChatMessage,
  finalizeRun,
  rejectWorkspaceSuggestion,
  removeContextItem,
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
): Pick<WorkspaceState, "appendUserChatMessage" | "acceptSuggestedEdit" | "rejectSuggestedEdit" | "askAboutSelectionStream" | "cancelActiveRun" | "regenerateLastTurn" | "sendChatPrompt" | "setChatPrompt" | "dismissChatRunError" | "addChatFileContext" | "removeChatContextItem"> => ({
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
    // Walk back to the most recent user message.
    let userIndex = -1;
    for (let i = thread.messages.length - 1; i >= 0; i -= 1) {
      const message = thread.messages[i];
      if (message.role === "user" && message.content?.trim()) {
        userIndex = i;
        break;
      }
    }
    if (userIndex < 0) {
      return;
    }
    const userText = thread.messages[userIndex].content ?? "";
    // Regenerate replaces the turn in place: drop that user message and every
    // response after it, then re-send its text — so a regen re-answers the same
    // question instead of appending a duplicate turn.
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => ({
        ...item,
        chatThread: {
          ...item.chatThread,
          messages: item.chatThread.messages.slice(0, userIndex),
          preparedCommand: null,
          prompt: userText,
        },
      })),
    }));
    await get().sendChatPrompt();
  },
  sendChatPrompt: (options) => runSendChatPrompt(set, get, options),
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
  // Clear a stale run-error banner once the user recovers the agent (starts
  // Ollama, or hits Retry). Without this it lingers until the next send, even
  // after the agent is back to ready.
  dismissChatRunError: () => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => ({
        ...item,
        chatThread: {
          ...item.chatThread,
          runError: null,
          runState: item.chatThread.runState === "error" ? "idle" : item.chatThread.runState,
        },
      })),
    }));
  },
  addChatFileContext: ({ label, path, origin }) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => ({
        ...item,
        chatThread: addFileContextItem(item.chatThread, item.id, path, label, origin),
      })),
    }));
  },
  removeChatContextItem: (id: string) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => ({
        ...item,
        chatThread: removeContextItem(item.chatThread, id),
      })),
    }));
  },
});
