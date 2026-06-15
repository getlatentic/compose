import type { Workspace } from "../workspaceModel";

/**
 * Find the active workspace from store state.
 *
 * Shared by the components that subscribe to NARROW active-file fields (the
 * editor region shell, the active-document editor, the status bar, the sidebar
 * panels) so each reads exactly the slice it needs through its own selector —
 * never the whole `workspaces` array. That array carries the chat thread, so a
 * whole-array subscription re-renders on every streaming token; a chat-only
 * update spreads `...item`, so the narrow field selectors built on this helper
 * keep their references and don't fire.
 */
export function selectActiveWorkspace(state: {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}): Workspace | null {
  return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? null;
}
