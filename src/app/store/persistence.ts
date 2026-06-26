import { saveWorkspaceComments } from "../../lib/ipc/commentsClient";
import { saveConversation } from "../../lib/ipc/conversationsClient";
import { saveWorkspaceTabs } from "../../lib/ipc/workspaceClient";
import {
  chatThreadContextFileLabels,
  serializeChatMessages,
  type Workspace,
} from "../workspaceModel";
import { errorMessage } from "./internals";
import { showErrorToast } from "../../features/toast/toastStore";
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
 * Persist a workspace's active conversation (settled turns only —
 * `serializeChatMessages` skips in-flight messages). Called on send (awaited, so
 * the first message lands before the run) and on turn completion. A no-op when
 * the thread has no conversation id yet. The save is a single upsert that
 * creates the row *with* its messages, so a conversation can never exist as a
 * 0-message "zombie". Retries once on a transient failure, refreshes the history
 * list on success, and surfaces a persistent failure as a toast — the webview
 * has no console in a release build, so a swallowed error would be invisible.
 *
 * `refreshList: false` skips the history-list refetch — used by the throttled
 * in-flight saves during a run (which fire every few seconds), so a streaming
 * turn doesn't churn the sidebar; the final save on completion refreshes it.
 */
export async function persistConversation(
  get: WorkspaceStoreGet,
  workspaceId: string,
  options?: { refreshList?: boolean },
): Promise<void> {
  const workspace = get().workspaces.find((item) => item.id === workspaceId);
  const conversationId = workspace?.chatThread.conversationId;
  if (!workspace || !conversationId) {
    return;
  }
  const messages = serializeChatMessages(workspace.chatThread);
  const contextFiles = chatThreadContextFileLabels(workspace.chatThread);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await saveConversation(workspaceId, conversationId, messages, contextFiles);
      if (options?.refreshList !== false) {
        void get().loadConversations(workspaceId);
      }
      return;
    } catch (error) {
      if (attempt === 0) {
        continue;
      }
      showErrorToast(errorMessage(error, "Couldn't save this conversation"));
    }
  }
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
