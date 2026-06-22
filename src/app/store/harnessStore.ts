import { create } from "zustand";
import {
  harnessList,
  harnessListModels,
  harnessModelManagement,
  harnessReadiness,
  type HarnessInfo,
  type HarnessModel,
  type HarnessModelManagement,
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
  /** Whether the AI may edit files. Global, persisted. */
  allowEdits: boolean;
  /** Global edit-review mode, sticky across agents. Persisted. */
  reviewEdits: boolean;
  /** Global extra system-prompt instructions for agents that honor them. Persisted. */
  customInstructions: string;
  /** Per-harness run tuning, keyed by harness id. Persisted. */
  harnessOptions: Record<string, HarnessRunOptions>;
  setSelectedHarness: (harnessId: string) => void;
  setAllowEdits: (allow: boolean) => void;
  setReviewEdits: (review: boolean) => void;
  setCustomInstructions: (instructions: string) => void;
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
  /** Per-harness local-model management capability (`harness_model_management`),
   * loaded lazily by the Settings panel. `null` once probed for a harness that
   * manages no models (every harness but Ollama); absent until probed. Drives
   * whether the "Manage models" section renders. */
  harnessModelManagement: Record<string, HarnessModelManagement | null>;
  loadHarnessModelManagement: (harnessId: string) => Promise<void>;
  /** Readiness of the *selected* harness, refreshed on boot and whenever the
   * selection changes or its credential/install is updated. Drives the send
   * gate and the setup-complete check for key-backed harnesses. */
  selectedHarnessReadiness: HarnessReadiness | null;
  setSelectedHarnessReadiness: (readiness: HarnessReadiness | null) => void;
  /** Re-probe the selected harness's readiness (+ refresh its live model list),
   * for the composer's "Retry" after a failure. Best-effort; a probe failure
   * resets readiness to null (reads as available, so Retry never locks the UI). */
  reloadSelectedHarnessReadiness: () => Promise<void>;
  /** First-run only (no agent chosen yet): select the first *ready* agent in
   * catalog order — which is Ollama-first — so the out-of-box default reflects
   * what the user actually has working. None ready → stays unset and AI is off
   * (the composer nudges to Settings). Probes in order and stops at the first
   * hit, so it never spins up every CLI. */
  resolveDefaultHarness: () => Promise<void>;
}

export const useHarnessStore = create<HarnessState>((set, get) => {
  const persist = () => {
    const state = get();
    persistHarnessPrefs({
      selectedHarnessId: state.selectedHarnessId,
      allowEdits: state.allowEdits,
      reviewEdits: state.reviewEdits,
      customInstructions: state.customInstructions,
      harnessOptions: state.harnessOptions,
    });
  };
  return {
  selectedHarnessId: INITIAL_HARNESS_PREFS.selectedHarnessId,
  allowEdits: INITIAL_HARNESS_PREFS.allowEdits,
  reviewEdits: INITIAL_HARNESS_PREFS.reviewEdits,
  customInstructions: INITIAL_HARNESS_PREFS.customInstructions,
  harnessOptions: INITIAL_HARNESS_PREFS.harnessOptions,
  setSelectedHarness: (harnessId) => {
    // Clear stale readiness immediately — it described the *previous* harness.
    // AppRouter re-probes on the selection change; null meanwhile reads as
    // "available", so the gate never flashes the wrong harness's state.
    set({ selectedHarnessId: harnessId, selectedHarnessReadiness: null });
    persist();
  },
  resolveDefaultHarness: async () => {
    // Respect an explicit choice; only fill in an out-of-box default.
    if (get().selectedHarnessId) {
      return;
    }
    for (const entry of get().harnessCatalog) {
      const readiness = await harnessReadiness(entry.id).catch(() => null);
      if (readiness?.ready) {
        get().setSelectedHarness(entry.id);
        return;
      }
    }
    // None ready — leave it unset; the composer shows a "set up an agent" nudge.
  },
  setAllowEdits: (allow) => {
    set({ allowEdits: allow });
    persist();
  },
  setReviewEdits: (review) => {
    set({ reviewEdits: review });
    persist();
  },
  setCustomInstructions: (instructions) => {
    set({ customInstructions: instructions });
    persist();
  },
  setHarnessOptions: (harnessId, options) => {
    set((state) => ({
      harnessOptions: {
        ...state.harnessOptions,
        [harnessId]: { ...state.harnessOptions[harnessId], ...options },
      },
    }));
    persist();
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
  harnessModelManagement: {},
  loadHarnessModelManagement: async (harnessId) => {
    // Best-effort; a failure resolves to null (no management surface shown).
    const management = await harnessModelManagement(harnessId).catch(() => null);
    set((state) => ({
      harnessModelManagement: { ...state.harnessModelManagement, [harnessId]: management },
    }));
  },
  selectedHarnessReadiness: null,
  setSelectedHarnessReadiness: (readiness) => {
    set({ selectedHarnessReadiness: readiness });
  },
  reloadSelectedHarnessReadiness: async () => {
    const harnessId = get().selectedHarnessId;
    const readiness = await harnessReadiness(harnessId).catch(() => null);
    set({ selectedHarnessReadiness: readiness });
    // A harness that discovers models live (Ollama) couldn't list them while it
    // was down — refresh now that it may be back so the picker repopulates.
    void get().loadHarnessModels(harnessId);
  },
  };
});
