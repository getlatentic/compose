import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceCommentThread } from "../../features/comments/commentModel";
import { isTauriRuntime } from "../runtime/desktopRuntime";

const fallbackCommentsByWorkspace = new Map<string, WorkspaceCommentThread[]>();

export async function loadWorkspaceComments(
  workspaceId: string,
): Promise<WorkspaceCommentThread[]> {
  if (!isTauriRuntime()) {
    return [...(fallbackCommentsByWorkspace.get(workspaceId) ?? [])];
  }
  return invoke<WorkspaceCommentThread[]>("metadata_load_comments", { workspaceId });
}

export async function saveWorkspaceComments(
  workspaceId: string,
  comments: WorkspaceCommentThread[],
): Promise<void> {
  if (!isTauriRuntime()) {
    fallbackCommentsByWorkspace.set(workspaceId, comments.map((comment) => ({ ...comment })));
    return;
  }
  await invoke<void>("metadata_save_comments", { workspaceId, comments });
}

export function _resetFallbackCommentsForTests() {
  fallbackCommentsByWorkspace.clear();
}
