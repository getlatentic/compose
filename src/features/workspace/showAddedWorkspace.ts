import { useWorkspaceStore } from "../../app/workspaceStore";
import type { WorkspaceListResult } from "../../lib/ipc/workspaceClient";

/** Show the workspace `workspace_add` returned, whether it was just added or
 *  already there: the store takes the registry's list, then switches to it. */
export function showAddedWorkspace(list: WorkspaceListResult): void {
  useWorkspaceStore.getState().hydrateWorkspaces(list);
  const added =
    list.workspaces.find((item) => item.id === list.activeWorkspaceId) ?? list.workspaces[list.workspaces.length - 1];
  if (added) useWorkspaceStore.getState().switchWorkspace(added.id);
}
