import type { WorkspaceState, WorkspaceStoreGet, WorkspaceStoreSet } from "./types";
import { showErrorToast } from "../../features/toast/toastStore";
import { useUiStore } from "./uiStore";
import {
  addWorkspaceComment,
  setCommentsChatContext,
  setWorkspaceCommentStatus,
} from "../workspaceModel";
import {
  persistComments,
} from "./persistence";
import {
  updateWorkspace,
} from "./internals";

export const createCommentsSlice = (
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
): Pick<WorkspaceState, "activeFileComments" | "addCommentToActiveFile" | "setCommentResolved" | "sendCommentToChat" | "sendCommentsToChat"> => ({
  activeFileComments: () => {
    const workspace = get().activeWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return [];
    }
    return workspace.comments.filter(
      (comment) => comment.filePath === workspace.activeFilePath && comment.status === "open",
    );
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
    persistComments(get().workspaces, workspace.id, showErrorToast);
  },
  setCommentResolved: (commentId, resolved) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
        setWorkspaceCommentStatus(item, commentId, resolved ? "resolved" : "open", Date.now()),
      ),
    }));
    persistComments(get().workspaces, workspace.id, showErrorToast);
  },
  sendCommentToChat: async (commentId: string) => {
    await get().sendCommentsToChat([commentId]);
  },
  sendCommentsToChat: async (commentIds: string[]) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    const comments = commentIds.flatMap((id) => {
      const found = workspace.comments.find((item) => item.id === id);
      return found ? [found] : [];
    });
    if (comments.length === 0) {
      return;
    }

    // 1 comment → its note is the prompt; N → a clear instruction, with every
    // passage+note carried as context (`createPromptWithContext` renders each
    // comment block). `.trim()` not just `||`: a whitespace note is truthy here
    // but trims to empty in `sendChatPrompt`, which would silently drop it.
    const prompt =
      comments.length === 1
        ? comments[0].body?.trim()
          ? comments[0].body
          : "Help me with this selection."
        : `Please address these ${comments.length} comments on this document.`;
    const filePath = comments[0].filePath;

    useUiStore.getState().openChat();
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => ({
        ...item,
        activeFilePath: filePath,
        chatThread: {
          ...setCommentsChatContext(item.chatThread, item.id, comments),
          prompt,
        },
        openFilePaths: item.openFilePaths.includes(filePath)
          ? item.openFilePaths
          : [...item.openFilePaths, filePath],
      })),
    }));

    await get().sendChatPrompt();
  },
});
