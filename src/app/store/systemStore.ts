import { create } from "zustand";
import { systemReadiness, type DependencyStatus } from "../../lib/ipc/systemClient";

/**
 * Optional local-AI dependency statuses (the "Local AI" settings panel). A
 * standalone leaf store (like {@link useHarnessStore}): nothing here affects
 * the editor, so reading it never re-renders document surfaces.
 */
export interface SystemState {
  statuses: DependencyStatus[];
  loaded: boolean;
  loadSystemReadiness: () => Promise<void>;
}

export const useSystemStore = create<SystemState>((set) => ({
  statuses: [],
  loaded: false,
  loadSystemReadiness: async () => {
    const statuses = await systemReadiness().catch(() => [] as DependencyStatus[]);
    set({ statuses, loaded: true });
  },
}));
