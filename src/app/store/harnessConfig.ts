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
  /** Keyed by harness id (`bob` / `claude` / `codex`). */
  harnessOptions: Record<string, HarnessRunOptions>;
}

/** Load the persisted harness selection + edit permission + per-harness run
 * options. Fresh-start default is Claude (the top of the availability priority,
 * before onboarding's detection-driven pick refines it). */
export function loadHarnessPrefs(): HarnessPrefs {
  const fallback: HarnessPrefs = { selectedHarnessId: "claude", allowEdits: true, harnessOptions: {} };
  if (typeof localStorage === "undefined") {
    return fallback;
  }
  try {
    const raw = localStorage.getItem(HARNESS_PREFS_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<HarnessPrefs>;
    return {
      selectedHarnessId:
        typeof parsed.selectedHarnessId === "string" && parsed.selectedHarnessId
          ? parsed.selectedHarnessId
          : fallback.selectedHarnessId,
      allowEdits: typeof parsed.allowEdits === "boolean" ? parsed.allowEdits : fallback.allowEdits,
      harnessOptions:
        parsed.harnessOptions && typeof parsed.harnessOptions === "object"
          ? (parsed.harnessOptions as Record<string, HarnessRunOptions>)
          : fallback.harnessOptions,
    };
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
 * opt-in via the per-harness "Review changes before applying" toggle.
 */
export function editGuardFor(
  capabilities: HarnessCapabilities,
  allowEdits: boolean,
  options: HarnessRunOptions,
): EditGuard {
  if (capabilities.previewsEdits) {
    return "none";
  }
  if (!allowEdits) {
    return "none";
  }
  return options.reviewEdits === true ? "clone" : "snapshot";
}
