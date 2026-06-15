import { saveWorkspaceComments } from "../../lib/ipc/commentsClient";
import { saveConversation } from "../../lib/ipc/conversationsClient";
import { saveWorkspaceTabs } from "../../lib/ipc/workspaceClient";
import {
  chatThreadContextFileLabels,
  serializeChatMessages,
  type Workspace,
} from "../workspaceModel";
import { errorMessage } from "./internals";
import type { WorkspaceStoreGet } from "./types";

export function persistTabs(workspaces: Workspace[], workspaceId: string) {
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
export function persistConversation(get: WorkspaceStoreGet, workspaceId: string) {
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

export function persistComments(
  workspaces: Workspace[],
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
