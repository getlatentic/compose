import { create } from "zustand";
import { systemReadiness, type DependencyStatus } from "../../lib/ipc/systemClient";

/**
 * System dependency statuses for the "Get ready" doctor. A standalone leaf
 * store (like {@link useHarnessStore}): nothing here affects the editor, so
 * reading it never re-renders document surfaces. `installingId` marks the
 * dependency whose install is currently streaming, so the UI can disable the
 * other rows while one runs.
 */
export interface SystemState {
  statuses: DependencyStatus[];
  loaded: boolean;
  installingId: string | null;
  loadSystemReadiness: () => Promise<void>;
  setInstallingId: (id: string | null) => void;
}

export const useSystemStore = create<SystemState>((set) => ({
  statuses: [],
  loaded: false,
  installingId: null,
  loadSystemReadiness: async () => {
    const statuses = await systemReadiness().catch(() => [] as DependencyStatus[]);
    set({ statuses, loaded: true });
  },
  setInstallingId: (id) => set({ installingId: id }),
}));
