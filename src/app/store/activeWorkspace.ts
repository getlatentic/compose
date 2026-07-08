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

/** The loose pseudo-workspace holding external files (#113) — the single
 *  lookup every consumer shares. */
export function selectLooseWorkspace(state: { workspaces: Workspace[] }): Workspace | null {
  return state.workspaces.find((workspace) => workspace.kind === "loose") ?? null;
}

/**
 * The container whose active file the EDITOR shows (#113): the loose
 * pseudo-workspace while an external file is focused, else the active real
 * workspace. Editor-surface components (document, tabs, status bar) select
 * through this; workspace-scoped surfaces (tree, chat, switcher) keep using
 * {@link selectActiveWorkspace}.
 */
export function selectFocusedWorkspace(state: {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  focusedArea: "workspace" | "loose";
}): Workspace | null {
  if (state.focusedArea === "loose") {
    return selectLooseWorkspace(state);
  }
  return selectActiveWorkspace(state);
}
