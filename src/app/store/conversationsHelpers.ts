import type { ConversationSummary } from "../../lib/ipc/conversationsClient";
import { resetChatThread } from "../workspaceModel";
import { updateWorkspace } from "./internals";
import type { WorkspaceStoreGet, WorkspaceStoreSet } from "./types";

/**
 * Grace window for the soft-delete undo affordance. The conversation leaves
 * the list immediately, but the persisted delete only commits after this
 * delay — so an Undo within the window cancels the IPC entirely and the row
 * is restored with no server round-trip.
 */
export const CONVERSATION_DELETE_GRACE_MS = 6000;

/** Pending soft-deletes keyed by `${workspaceId}:${conversationId}`, so Undo
 * can cancel the timer before it fires. Module-level: timers outlive any one
 * render and there is exactly one store. */
export const conversationDeleteTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Replace one workspace's conversation list via a transform. */
export function patchConversationList(
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
export function openNextConversationOrReset(
  get: WorkspaceStoreGet,
  set: WorkspaceStoreSet,
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
