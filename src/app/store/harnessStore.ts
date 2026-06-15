import { create } from "zustand";
import { harnessList, type HarnessInfo } from "../../lib/ipc/harnessClient";
import type { BobInstallStatus } from "../../lib/ipc/settingsClient";
import type { BobAuthStatus } from "../workspaceModel";
import { persistHarnessPrefs } from "./harnessConfig";
import { INITIAL_HARNESS_PREFS } from "./initialPrefs";
import type { HarnessRunOptions } from "./types";

/**
 * Harness selection, per-harness run options, and Bob credential/install
 * status. A **standalone store**, not a slice of the workspace store: nothing
 * here changes on document edits, so components that read harness config never
 * re-render on typing, and the editor/file tree never re-render when the user
 * picks a model. The only cross-store traffic is the chat-run path *reading*
 * this config via `useHarnessStore.getState()` — a one-directional dependency
 * (workspace store → harness store), which keeps this store a pure leaf.
 */
export interface HarnessState {
  /** Whether Bob's managed API key is configured + any verification error. */
  bobAuthStatus: BobAuthStatus;
  /** Result of the last Bob CLI install check, or null before one runs. */
  bobInstallStatus: BobInstallStatus | null;
  setBobAuthStatus: (status: BobAuthStatus) => void;
  setBobInstallStatus: (status: BobInstallStatus | null) => void;
  /** The harness the user picked (bob / claude / codex / …). Persisted. */
  selectedHarnessId: string;
  /** Whether the active harness may edit files. Persisted. */
  allowEdits: boolean;
  /** Per-harness run tuning, keyed by harness id. Persisted. */
  harnessOptions: Record<string, HarnessRunOptions>;
  setSelectedHarness: (harnessId: string) => void;
  setAllowEdits: (allow: boolean) => void;
  setHarnessOptions: (harnessId: string, options: Partial<HarnessRunOptions>) => void;
  /** Declarative capabilities for every registered harness, loaded once at
   * bootstrap. Empty in the browser preview (the registry is desktop-only). */
  harnessCatalog: HarnessInfo[];
  loadHarnessCatalog: () => Promise<void>;
}

export const useHarnessStore = create<HarnessState>((set, get) => ({
  bobAuthStatus: { configured: false },
  bobInstallStatus: null,
  setBobAuthStatus: (status) => {
    set({ bobAuthStatus: status });
  },
  setBobInstallStatus: (status) => {
    set({ bobInstallStatus: status });
  },
  selectedHarnessId: INITIAL_HARNESS_PREFS.selectedHarnessId,
  allowEdits: INITIAL_HARNESS_PREFS.allowEdits,
  harnessOptions: INITIAL_HARNESS_PREFS.harnessOptions,
  setSelectedHarness: (harnessId) => {
    set({ selectedHarnessId: harnessId });
    persistHarnessPrefs({
      selectedHarnessId: harnessId,
      allowEdits: get().allowEdits,
      harnessOptions: get().harnessOptions,
    });
  },
  setAllowEdits: (allow) => {
    set({ allowEdits: allow });
    persistHarnessPrefs({
      selectedHarnessId: get().selectedHarnessId,
      allowEdits: allow,
      harnessOptions: get().harnessOptions,
    });
  },
  setHarnessOptions: (harnessId, options) => {
    set((state) => ({
      harnessOptions: {
        ...state.harnessOptions,
        [harnessId]: { ...state.harnessOptions[harnessId], ...options },
      },
    }));
    persistHarnessPrefs({
      selectedHarnessId: get().selectedHarnessId,
      allowEdits: get().allowEdits,
      harnessOptions: get().harnessOptions,
    });
  },
  harnessCatalog: [],
  loadHarnessCatalog: async () => {
    // Best-effort: the registry is desktop-only, so this resolves to [] in the
    // browser preview (the static fallback in `harnessCapabilitiesOf` covers
    // that). Never throws into bootstrap.
    const catalog = await harnessList().catch(() => [] as HarnessInfo[]);
    set({ harnessCatalog: catalog });
  },
}));
