import { create } from "zustand";
import type { WorkspaceIndexSnapshot } from "../../lib/ipc/indexClient";

export type WorkspaceIndexState = "idle" | "indexing" | "ready" | "failed";

export interface WorkspaceIndexEntry {
  snapshot: WorkspaceIndexSnapshot | null;
  state: WorkspaceIndexState;
  error: string | null;
}

const IDLE: WorkspaceIndexEntry = { snapshot: null, state: "idle", error: null };

interface IndexStoreState {
  byWorkspace: Record<string, WorkspaceIndexEntry>;
  setIndexing: (workspaceId: string) => void;
  setSnapshot: (workspaceId: string, snapshot: WorkspaceIndexSnapshot) => void;
  setFailed: (workspaceId: string, error: string) => void;
}

/**
 * The per-workspace search index (snapshot + state), kept in its OWN store —
 * deliberately NOT on the `Workspace` object. `rebuildWorkspaceIndex` runs
 * on **every save**; if the snapshot lived on the workspace, each rebuild would
 * churn the workspace identity and re-render the file tree, tabs, and sidebar.
 * Isolated here, an index rebuild only re-renders what actually reads the index
 * — backlinks and search.
 */
export const useIndexStore = create<IndexStoreState>((set) => ({
  byWorkspace: {},
  setIndexing: (workspaceId) =>
    set((state) => ({
      byWorkspace: {
        ...state.byWorkspace,
        [workspaceId]: { ...(state.byWorkspace[workspaceId] ?? IDLE), state: "indexing", error: null },
      },
    })),
  setSnapshot: (workspaceId, snapshot) =>
    set((state) =>
      snapshot.workspaceId !== workspaceId
        ? state
        : {
            byWorkspace: {
              ...state.byWorkspace,
              [workspaceId]: { snapshot, state: "ready", error: null },
            },
          },
    ),
  setFailed: (workspaceId, error) =>
    set((state) => ({
      byWorkspace: {
        ...state.byWorkspace,
        [workspaceId]: { ...(state.byWorkspace[workspaceId] ?? IDLE), state: "failed", error },
      },
    })),
}));

/** Subscribe to one workspace's index entry (a stable IDLE default when none). */
export function useWorkspaceIndex(workspaceId: string | null): WorkspaceIndexEntry {
  return useIndexStore((state) => (workspaceId ? state.byWorkspace[workspaceId] ?? IDLE : IDLE));
}
