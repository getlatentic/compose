import { create } from "zustand";
import {
  harnessList,
  harnessListModels,
  type HarnessInfo,
  type HarnessModel,
  type HarnessReadiness,
} from "../../lib/ipc/harnessClient";
import { persistHarnessPrefs } from "./harnessConfig";
import { INITIAL_HARNESS_PREFS } from "./initialPrefs";
import type { HarnessRunOptions } from "./types";

/**
 * Harness selection, per-harness run options, discovered capabilities/models,
 * and the selected harness's readiness. A **standalone store**, not a slice of
 * the workspace store: nothing here changes on document edits, so components
 * that read harness config never re-render on typing, and the editor/file tree
 * never re-render when the user picks a model. The only cross-store traffic is
 * the chat-run path *reading* this config via `useHarnessStore.getState()` — a
 * one-directional dependency (workspace store → harness store), which keeps this
 * store a pure leaf.
 */
export interface HarnessState {
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
  /** Models discovered live per harness (`harness_list_models`) for harnesses
   * whose set isn't curated at compile time (Ollama, OpenCode, OpenRouter,
   * Codex). Keyed by harness id; absent until loaded, `[]` when discovery finds
   * none (the picker then falls back to a free-text model field). */
  harnessModels: Record<string, HarnessModel[]>;
  loadHarnessModels: (harnessId: string) => Promise<void>;
  /** Readiness of the *selected* harness, refreshed on boot and whenever the
   * selection changes or its credential/install is updated. Drives the send
   * gate and the setup-complete check for key-backed harnesses. */
  selectedHarnessReadiness: HarnessReadiness | null;
  setSelectedHarnessReadiness: (readiness: HarnessReadiness | null) => void;
}

export const useHarnessStore = create<HarnessState>((set, get) => ({
  selectedHarnessId: INITIAL_HARNESS_PREFS.selectedHarnessId,
  allowEdits: INITIAL_HARNESS_PREFS.allowEdits,
  harnessOptions: INITIAL_HARNESS_PREFS.harnessOptions,
  setSelectedHarness: (harnessId) => {
    // Clear stale readiness immediately — it described the *previous* harness.
    // AppRouter re-probes on the selection change; null meanwhile reads as
    // "available", so the gate never flashes the wrong harness's state.
    set({ selectedHarnessId: harnessId, selectedHarnessReadiness: null });
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
  harnessModels: {},
  loadHarnessModels: async (harnessId) => {
    // Best-effort; failures resolve to [] (the picker falls back to free-text).
    const models = await harnessListModels(harnessId).catch(() => [] as HarnessModel[]);
    set((state) => ({ harnessModels: { ...state.harnessModels, [harnessId]: models } }));
  },
  selectedHarnessReadiness: null,
  setSelectedHarnessReadiness: (readiness) => {
    set({ selectedHarnessReadiness: readiness });
  },
}));
