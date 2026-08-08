import {
  type EditGuard,
  type HarnessCapabilities,
  type HarnessInfo,
} from "../../lib/ipc/harnessClient";
import type { HarnessRunOptions } from "./types";

const HARNESS_PREFS_KEY = "compose.harnessPrefs";

/** Compose's default permission mode per harness — its run policy, overridable
 * by the per-harness `permissionMode` setting. Claude runs fully headless (no
 * one to answer a prompt), so it bypasses; other harnesses use their own. A
 * default that lives at the Compose level, not baked into the adapter. */
function defaultPermissionMode(harnessId: string): string | undefined {
  return harnessId === "claude" ? "bypassPermissions" : undefined;
}

/**
 * Build a run's extra CLI args from config: the permission-mode setting (or
 * Compose's default), threaded to any harness through `RunTuning.extra_args`.
 * Returns the empty list when no mode applies, so the adapter keeps its default.
 */
export function harnessExtraArgs(harnessId: string, options: HarnessRunOptions): string[] {
  const mode = options.permissionMode ?? defaultPermissionMode(harnessId);
  return mode ? ["--permission-mode", mode] : [];
}

/** Whether a harness exposes a permission-mode control in Settings. Only Claude
 * Code has `--permission-mode` today (Codex uses `--full-auto`, bob its own
 * approval mode); a `supportsPermissionMode` capability on the catalog would
 * replace this id check once agent-harness declares it. */
export function supportsPermissionMode(harnessId: string): boolean {
  return harnessId === "claude";
}

export interface HarnessPrefs {
  selectedHarnessId: string;
  allowEdits: boolean;
  /** Global edit-review mode, sticky across agents: true → review edits on a
   *  copy before they apply; false → apply directly (undoable via a snapshot). */
  reviewEdits: boolean;
  /** Global extra system-prompt instructions, applied to every agent that honors
   *  them (the openai-compatible adapters). Empty → none. */
  customInstructions: string;
  /** Keyed by harness id (`compose` / `claude` / `codex`). */
  harnessOptions: Record<string, HarnessRunOptions>;
  /** Which endpoint the built-in `compose` agent talks to — `ollama`,
   *  `openrouter`, a custom one. Only meaningful while `compose` is selected;
   *  kept across agent switches so returning to it restores the last provider. */
  selectedProviderId: string;
  /** Per-provider run options, chiefly the model. Separate from
   *  `harnessOptions` because one agent has many providers, and each remembers
   *  its own model. */
  providerOptions: Record<string, HarnessRunOptions>;
}

/**
 * Agent ids that became providers of the built-in `compose` agent.
 *
 * They were never separate agents. Each was one `OpenHarness` — the same loop,
 * the same tools — differing only in `base_url` and which environment variable
 * holds the key. Listing them as peers of Claude Code asked the user two
 * different questions in one control: which agent does the work, and where do
 * the tokens come from.
 */
const MIGRATED_PROVIDER_IDS = ["ollama", "openrouter"];

/** The built-in agent's id in the registry. */
export const COMPOSE_HARNESS_ID = "compose";

/**
 * Carry a selection made before providers existed.
 *
 * Without this, the stale-agent guard in `resolveDefaultHarness` sees an id
 * that is no longer in the catalog, treats it as unset, and silently re-picks —
 * so every existing user loses their agent AND the model they chose. A
 * migration is the difference between an upgrade and a reset.
 */
function migrateProviderSelection(prefs: HarnessPrefs): HarnessPrefs {
  const wasProvider =
    MIGRATED_PROVIDER_IDS.includes(prefs.selectedHarnessId) ||
    prefs.selectedHarnessId.startsWith("custom:openai:");
  if (!wasProvider) {
    return prefs;
  }
  const providerId = prefs.selectedHarnessId;
  const carried = prefs.harnessOptions[providerId];
  return {
    ...prefs,
    selectedHarnessId: COMPOSE_HARNESS_ID,
    selectedProviderId: providerId,
    // The model was stored against the old agent id. Move it to the provider
    // so the next run uses the same model the user last chose.
    providerOptions: carried
      ? { ...prefs.providerOptions, [providerId]: carried }
      : prefs.providerOptions,
  };
}

/** Load the persisted harness selection + edit permission + per-harness run
 * options. Fresh start leaves the agent *unset* (`""`): boot derives it from the
 * first ready agent in Ollama-first order, and a "set up an agent" nudge shows if
 * none is ready (AI is optional). An explicit pick is persisted and always wins. */
export function loadHarnessPrefs(): HarnessPrefs {
  const fallback: HarnessPrefs = {
    selectedHarnessId: "",
    allowEdits: true,
    reviewEdits: false,
    customInstructions: "",
    harnessOptions: {},
    selectedProviderId: "",
    providerOptions: {},
  };
  if (typeof localStorage === "undefined") {
    return fallback;
  }
  try {
    const raw = localStorage.getItem(HARNESS_PREFS_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<HarnessPrefs>;
    return migrateProviderSelection({
      selectedHarnessId:
        typeof parsed.selectedHarnessId === "string" && parsed.selectedHarnessId
          ? parsed.selectedHarnessId
          : fallback.selectedHarnessId,
      allowEdits: typeof parsed.allowEdits === "boolean" ? parsed.allowEdits : fallback.allowEdits,
      reviewEdits:
        typeof parsed.reviewEdits === "boolean" ? parsed.reviewEdits : fallback.reviewEdits,
      customInstructions:
        typeof parsed.customInstructions === "string"
          ? parsed.customInstructions
          : fallback.customInstructions,
      harnessOptions:
        parsed.harnessOptions && typeof parsed.harnessOptions === "object"
          ? (parsed.harnessOptions as Record<string, HarnessRunOptions>)
          : fallback.harnessOptions,
      selectedProviderId:
        typeof parsed.selectedProviderId === "string"
          ? parsed.selectedProviderId
          : fallback.selectedProviderId,
      providerOptions:
        parsed.providerOptions && typeof parsed.providerOptions === "object"
          ? (parsed.providerOptions as Record<string, HarnessRunOptions>)
          : fallback.providerOptions,
    });
  } catch {
    return fallback;
  }
}

export function persistHarnessPrefs(prefs: HarnessPrefs) {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(HARNESS_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort; ignore quota / availability errors.
  }
}

/**
 * Capabilities for a harness, read from the loaded catalog — the source of
 * truth for credential gating and the options UI. Every credential/preview
 * branch reads this instead of comparing the harness id. Before the catalog
 * loads (browser preview, pre-bootstrap) it returns conservative no-capability
 * defaults; the loaded catalog then supplies the real ones.
 */
export function harnessCapabilitiesOf(
  catalog: HarnessInfo[],
  harnessId: string,
): HarnessCapabilities {
  const info = catalog.find((entry) => entry.id === harnessId);
  if (info) {
    return info.capabilities;
  }
  return {
    credentialRequired: false,
    previewsEdits: false,
    models: [],
    allowsCustomModel: false,
    supportsEffort: false,
    supportsMaxTurns: false,
    supportsLogin: false,
    supportsCustomInstructions: false,
  };
}

/**
 * Pick the edit-review mode for a run. bob previews its own edits (no gate);
 * a read-only plan/ask run makes no edits to guard. A write-capable CLI harness
 * (Claude/Codex) runs in your REAL folder by default (`snapshot` — a pre-run
 * baseline makes every edit undoable from version history), so the agent sees
 * real paths, keeps one stable project identity, and its skills/memory line up.
 * Cloning to a throwaway copy fragments all of that (see review-guide). Strict
 * pre-approval (`clone` — work on a copy, approve the diff before it lands) is
 * opt-in via the global "Review changes before applying" toggle.
 */
export function editGuardFor(
  capabilities: HarnessCapabilities,
  allowEdits: boolean,
  reviewEdits: boolean,
): EditGuard {
  if (capabilities.previewsEdits) {
    return "none";
  }
  if (!allowEdits) {
    return "none";
  }
  return reviewEdits ? "clone" : "snapshot";
}
