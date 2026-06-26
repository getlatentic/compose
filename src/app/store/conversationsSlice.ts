import type { WorkspaceState, WorkspaceStoreGet, WorkspaceStoreSet } from "./types";
import { useUiStore } from "./uiStore";
import {
  CONVERSATION_DELETE_GRACE_MS,
  conversationDeleteTimers,
  openNextConversationOrReset,
  patchConversationList,
} from "./conversationsHelpers";
import {
  archiveConversation as archiveConversationIpc,
  deleteConversation as deleteConversationIpc,
  duplicateConversation as duplicateConversationIpc,
  listConversations,
  loadConversation,
  renameConversation as renameConversationIpc,
} from "../../lib/ipc/conversationsClient";
import {
  hydrateChatThread,
  resetChatThread,
} from "../workspaceModel";
import {
  pushNavEntry,
} from "./navigation";
import {
  updateWorkspace,
} from "./internals";

/** Per-workspace request counter so a stale `loadConversations` response can't
 *  overwrite a newer one — they race on workspace open vs. the post-send
 *  refresh, and an earlier fetch landing last would drop a just-created
 *  conversation from history until the next app reload. */
const conversationLoadSeq = new Map<string, number>();

export const createConversationsSlice = (
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
): Pick<WorkspaceState, "conversations" | "conversationDeleteNotice" | "loadConversations" | "openConversation" | "openConversationFromSidebar" | "newChat" | "renameConversation" | "archiveConversation" | "deleteConversation" | "undoDeleteConversation" | "duplicateConversation"> => ({
  conversations: {},
  conversationDeleteNotice: null,
  loadConversations: async (workspaceId: string) => {
    // The list always includes archived rows (the UI filters by the
    // `archived` flag), so the history dropdown, All view, and Archived
    // filter all read from one fetch.
    const seq = (conversationLoadSeq.get(workspaceId) ?? 0) + 1;
    conversationLoadSeq.set(workspaceId, seq);
    const summaries = await listConversations(workspaceId, true).catch((error) => {
      // Surface (don't swallow) — a silent failure here is what leaves history
      // empty until the next reload.
      console.error(`loadConversations(${workspaceId}) failed`, error);
      return null;
    });
    // Drop a stale or failed response; a newer load already superseded this one.
    if (!summaries || conversationLoadSeq.get(workspaceId) !== seq) {
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
      useUiStore.getState().openChat();
      return;
    }
    // Opening bumps `last_opened_at` server-side, so this conversation
    // becomes the one restored on next load.
    const snapshot = await loadConversation(workspaceId, conversationId).catch(() => null);
    if (!snapshot) {
      return;
    }
    set((state) => {
      const updated = updateWorkspace(state.workspaces, workspaceId, (item) => ({
        ...item,
        chatThread: hydrateChatThread(item.chatThread, snapshot),
      }));
      const navPatch = pushNavEntry(state, {
        kind: "chat",
        id: conversationId,
        workspaceId,
      });
      return navPatch
        ? { workspaces: updated, ...navPatch }
        : { workspaces: updated };
    });
    useUiStore.getState().openChat();
    void get().loadConversations(workspaceId);
  },
  openConversationFromSidebar: async (conversationId: string) => {
    // Reveal chat (openConversation also sets chatOpen, but a no-op
    // same-conversation open below would otherwise skip it) and pulse the
    // panel border. The editor is left exactly as-is — switching to the Chat
    // tab never closes the editor.
    useUiStore.getState().pulseChatPanel();
    await get().openConversation(conversationId);
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
});
