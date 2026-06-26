import { create } from "zustand";
import {
  harnessList,
  harnessListModels,
  harnessModelManagement,
  harnessReadiness,
  ollamaInstalled,
  startOllama,
  type HarnessInfo,
  type HarnessModel,
  type HarnessModelManagement,
  type HarnessReadiness,
} from "../../lib/ipc/harnessClient";
import { persistHarnessPrefs } from "./harnessConfig";
import { INITIAL_HARNESS_PREFS } from "./initialPrefs";
import type { HarnessRunOptions } from "./types";

// Ollama lists chat AND embedding models together (one `/api/tags`), but an
// embedding model can't chat — auto-picking one would make the first run fail.
// `/api/tags` gives only the name, so match the well-known embedding families by
// name; the user can still pick one explicitly in Settings if they really want.
const EMBEDDING_MODEL_NAME = /embed|minilm|^bge[-:]/i;

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
  /** Per-agent readiness for the picker's status dots, cached with a probe time
   * so the picker doesn't re-probe on every open. */
  harnessStatusById: Record<string, { ready: boolean; at: number }>;
  /** Agents whose readiness probe is in flight → a "connecting" dot. */
  harnessProbing: Record<string, boolean>;
  /** Lazily probe agents whose cached status is missing or stale (capped,
   * concurrent) — for the picker's status dots. Cheap to call repeatedly. */
  refreshHarnessStatuses: () => Promise<void>;
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
  /** Whether first-run default-agent resolution has finished. False until
   * `resolveDefaultHarness` completes, so the composer can show a "connecting"
   * state during the boot probe instead of a premature "set up an agent" error
   * (the selection is transiently null while the probe runs). */
  defaultHarnessResolved: boolean;
  /** First-run only (no agent chosen yet): select the first *ready* agent in
   * catalog priority order — Ollama-first — so the out-of-box default reflects
   * what the user actually has working. Probes every agent concurrently (a slow
   * CLI probe mustn't serialize ahead of a ready local agent); none ready →
   * stays unset and AI is off (the composer nudges to Settings). */
  resolveDefaultHarness: () => Promise<void>;
  /** Pin a default model for an agent that has none set, so an agent with no
   * built-in default (Ollama can't run without a model) works out of the box.
   * Loads the live model list and selects the first; a no-op for an agent that
   * already has a model, or one with no discovered list (it defaults fine). */
  resolveDefaultModel: (harnessId: string) => Promise<void>;
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
  defaultHarnessResolved: false,
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
    // No agent chosen yet → pick the first ready one in catalog priority order.
    if (!get().selectedHarnessId) {
      // Fire every probe at once, then AWAIT them in catalog priority order
      // (Ollama leads) and stop at the first ready agent: a fast local probe
      // (Ollama is an HTTP check) selects immediately instead of blocking on the
      // slow CLI probes behind it (each shells out under the login-shell PATH,
      // ~1s). `Promise.all` would wait for the slowest even when Ollama answered.
      const probes = get().harnessCatalog.map((entry) => ({
        id: entry.id,
        ready: harnessReadiness(entry.id)
          .then((readiness) => readiness?.ready ?? false)
          .catch(() => false),
      }));
      for (const probe of probes) {
        if (await probe.ready) {
          get().setSelectedHarness(probe.id);
          break;
        }
      }
      // None ready, but Ollama (the recommended local agent) is installed →
      // default to it; its server is just stopped, and we start it below.
      if (!get().selectedHarnessId && (await ollamaInstalled().catch(() => false))) {
        get().setSelectedHarness("ollama");
      }
    }
    // Ollama installed but not running → launch it (one `open -a`, the same as the
    // composer's button) so AI works without a manual click. Covers a fresh
    // default AND a returning user whose Ollama server is stopped.
    if (get().selectedHarnessId === "ollama") {
      const running = await harnessReadiness("ollama")
        .then((readiness) => readiness?.ready ?? false)
        .catch(() => false);
      if (!running && (await ollamaInstalled().catch(() => false))) {
        await startOllama().catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await get().reloadSelectedHarnessReadiness();
      }
    }
    // Ensure the selected agent has a model if it needs one (Ollama can't run
    // without one), so the composer works out of the box — for a fresh default
    // AND a returning selection that never got a model.
    const selected = get().selectedHarnessId;
    if (selected) {
      await get().resolveDefaultModel(selected);
    }
    set({ defaultHarnessResolved: true });
  },
  resolveDefaultModel: async (harnessId) => {
    // Respect an explicit model choice.
    if (get().harnessOptions[harnessId]?.model) {
      return;
    }
    // Discover the agent's models and pin the first CHAT model as the default —
    // an agent with no built-in default (Ollama) can't run otherwise. Embedding
    // models are skipped (they can't chat, so the run would fail); if there's no
    // chat model at all, leave it unset and let the composer nudge to pull one.
    // An agent that defaults fine surfaces no discovered list here, so no-ops.
    await get().loadHarnessModels(harnessId);
    const chatModel = (get().harnessModels[harnessId] ?? []).find(
      (model) => !EMBEDDING_MODEL_NAME.test(model.value),
    );
    if (chatModel) {
      get().setHarnessOptions(harnessId, { model: chatModel.value });
    }
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
  harnessStatusById: {},
  harnessProbing: {},
  refreshHarnessStatuses: async () => {
    // The picker's per-agent dots. Probe only agents whose cached status is
    // missing or stale, so reopening the picker is cheap; cap concurrency so a
    // burst of CLI probes doesn't shell out the whole set at once.
    const FRESH_MS = 15_000;
    const now = Date.now();
    const stale = get().harnessCatalog.filter((entry) => {
      if (get().harnessProbing[entry.id]) return false;
      const cached = get().harnessStatusById[entry.id];
      return !cached || now - cached.at > FRESH_MS;
    });
    if (stale.length === 0) {
      return;
    }
    set((state) => ({
      harnessProbing: {
        ...state.harnessProbing,
        ...Object.fromEntries(stale.map((entry) => [entry.id, true])),
      },
    }));
    const probe = async (entry: HarnessInfo) => {
      const ready = await harnessReadiness(entry.id)
        .then((readiness) => readiness?.ready ?? false)
        .catch(() => false);
      set((state) => ({
        harnessStatusById: { ...state.harnessStatusById, [entry.id]: { ready, at: Date.now() } },
        harnessProbing: { ...state.harnessProbing, [entry.id]: false },
      }));
    };
    for (let index = 0; index < stale.length; index += 4) {
      await Promise.all(stale.slice(index, index + 4).map(probe));
    }
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
