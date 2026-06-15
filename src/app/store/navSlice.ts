import type { WorkspaceState, WorkspaceStoreGet, WorkspaceStoreSet } from "./types";
import { applyNavEntry } from "./navigation";

/**
 * Window-local back/forward history across files and conversations. Stays in
 * the workspace store (not the UI store): entries are pushed *atomically with*
 * `workspaces` on the hot path (`selectFile`/`openConversation`/
 * `switchWorkspace`), and back/forward drive document selection through
 * `applyNavEntry` → `selectFile`/`openConversation`. Splitting it out would
 * turn those single `set()`s into cross-store writes and form a cycle.
 */
export const createNavSlice = (
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
): Pick<WorkspaceState, "navHistory" | "navIndex" | "navigateBack" | "navigateForward"> => ({
  navHistory: [],
  navIndex: -1,
  navigateBack: () => {
    const { navHistory, navIndex } = get();
    if (navIndex <= 0) {
      return;
    }
    const target = navHistory[navIndex - 1];
    if (!target) {
      return;
    }
    set({ navIndex: navIndex - 1 });
    applyNavEntry(get, target);
  },
  navigateForward: () => {
    const { navHistory, navIndex } = get();
    if (navIndex >= navHistory.length - 1) {
      return;
    }
    const target = navHistory[navIndex + 1];
    if (!target) {
      return;
    }
    set({ navIndex: navIndex + 1 });
    applyNavEntry(get, target);
  },
});
