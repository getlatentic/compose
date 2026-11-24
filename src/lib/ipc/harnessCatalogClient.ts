import { invoke } from "@tauri-apps/api/core";
import type { HarnessModel } from "./harnessModelsClient";
import { isTauriRuntime } from "../runtime/desktopRuntime";
import { DESKTOP_RUNTIME_REQUIRED } from "./harnessRunClient";

/**
 * Which agents there are, what each can do, and whether each is ready to run.
 */

/**
 * What a harness supports — read by the picker, options panel, and run
 * gating so they adapt declaratively instead of branching on the
 * harness id. Mirrors `compose_core::HarnessCapabilities`.
 */
export interface HarnessCapabilities {
  /** Compose stores this harness's credential (bob). When false the CLI
   * owns its login and no credential/install preflight runs. */
  credentialRequired: boolean;
  /** Proposes previewable edits to approve (bob) vs writing to disk. */
  previewsEdits: boolean;
  /** Curated model choices for the picker. Empty → no curated list. */
  models: HarnessModel[];
  /** Accepts a free-text model id beyond `models` (codex). */
  customModel: boolean;
  /** Honors reasoning effort (codex). */
  effort: boolean;
  /** Honors a max-turns cap (claude). */
  maxTurns: boolean;
  /** Supports an interactive sign-in flow (claude/codex OAuth) the picker
   * can trigger when installed-but-not-signed-in. */
  login: boolean;
  /** Honors per-harness custom instructions (appended to the system prompt via
   * `RunTuning.extra_instructions`). True for the openai-compatible adapter
   * (Ollama / OpenRouter); the picker hides the field for harnesses that don't. */
  customInstructions: boolean;
}

/**
 * Where a user gets an agent that isn't on this machine. Compose discovers and
 * runs agents; it never installs them, so this is what a "Not installed" row
 * shows instead of an action button.
 */
export interface InstallHint {
  url: string;
  command: string | null;
}

/**
 * The wire shape of one `harness_list` entry, before [`harnessList`] flattens
 * it into a {@link HarnessInfo}. Identity and capability arrive separately
 * because the harness trait asks them at different frequencies.
 */
interface HarnessListing {
  manifest: Omit<HarnessInfo, "capabilities" | "provider">;
  capabilities: HarnessCapabilities;
  provider: ProviderInfo | null;
}

/**
 * Set when the entry is an OpenAI-compatible endpoint the built-in agent drives
 * — same loop, same tools, different base URL — and null when the entry is a
 * standalone agent that brings its own. Classified by the backend, which knows
 * how each was registered; a user-added endpoint gets an opaque `custom:<uuid>`
 * that says nothing.
 */
export interface ProviderInfo {
  /** Served from this machine: free, private, offline. */
  local: boolean;
}

/** One entry in the harness catalog (`harness_list` command). */
export interface HarnessInfo {
  id: string;
  displayName: string;
  description: string;
  installHint: InstallHint | null;
  capabilities: HarnessCapabilities;
  provider: ProviderInfo | null;
}

/** Probe result for one harness (`harness_readiness` command). */
export interface HarnessReadiness {
  harnessId: string;
  ready: boolean;
  installed: boolean;
  version: string | null;
  authConfigured: boolean;
  error: string | null;
  details: unknown;
}

/**
 * How a resolved agent binary was installed, surfaced by an adapter in its
 * readiness `details` (the claude adapter today). Drives the Runtimes panel's
 * install-kind badge. `"native"` is the self-updating vendor installer; `npm`
 * copies can go stale.
 */
export type InstallKind = "native" | "npm-global" | "homebrew" | "bundled" | "unknown";

/**
 * The runtime facts an adapter may attach to `HarnessReadiness.details` — where
 * its CLI resolves on PATH and how it was installed. Both optional: the field is
 * a free-form `serde_json::Value`, and an adapter that doesn't report them (or a
 * harness build predating the change) yields `{}`. The keys are snake_case
 * because `details` is a raw JSON value the struct's camelCase rename doesn't
 * reach.
 */
export interface HarnessRuntimeDetails {
  resolvedPath: string | null;
  installKind: InstallKind | null;
}

const INSTALL_KINDS: readonly InstallKind[] = [
  "native",
  "npm-global",
  "homebrew",
  "bundled",
  "unknown",
];

/**
 * Read the runtime facts (resolved path + install kind) from a readiness probe's
 * free-form `details`, defensively — an absent field, a non-object `details`, or
 * an unrecognized `install_kind` degrades to `null` so the panel renders
 * version + status regardless. Keeps every `details`-shape assumption in the IPC
 * layer, not the view.
 */
export function runtimeDetailsOf(readiness: HarnessReadiness | null): HarnessRuntimeDetails {
  const details = readiness?.details;
  if (!details || typeof details !== "object") {
    return { resolvedPath: null, installKind: null };
  }
  const record = details as Record<string, unknown>;
  const resolvedPath = typeof record.resolved_path === "string" ? record.resolved_path : null;
  const rawKind = record.install_kind;
  const installKind =
    typeof rawKind === "string" && (INSTALL_KINDS as readonly string[]).includes(rawKind)
      ? (rawKind as InstallKind)
      : null;
  return { resolvedPath, installKind };
}

/**
 * The harness catalog for the Settings picker. Desktop-only; the
 * browser preview drives bob via its own path and doesn't expose a
 * harness registry today.
 */
export async function harnessList(): Promise<HarnessInfo[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  // The harness registry answers `{ manifest, capabilities }` — it asks identity
  // once and capability constantly, so the trait keeps them apart. Everything
  // above this line wants one object per agent, and this is the layer whose job
  // that is.
  const listings = await invoke<HarnessListing[]>("harness_list");
  return listings.map(({ manifest, capabilities, provider }) => ({
    ...manifest,
    capabilities,
    provider: provider ?? null,
  }));
}

/** Probe one harness's readiness (installed / version / auth). */
export async function harnessReadiness(
  harnessId: string,
  /** Include auth state — which for a hosted provider means READING the stored
   *  key. Off by default: the boot probe wants `installed`, and asking for auth
   *  there made launching the app open the keychain. Settings, which displays
   *  auth state, opts in. */
  withAuth = false,
): Promise<HarnessReadiness | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  return invoke<HarnessReadiness>("harness_readiness", { harnessId, withAuth });
}

/** Probe every registered harness's readiness in one pass, so the picker
 * discovers what's on this machine without a per-harness fan-out. Desktop-only;
 * the browser preview has no registry. */
export async function harnessDiscover(): Promise<HarnessReadiness[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<HarnessReadiness[]>("harness_discover");
}

/** Result of a harness runtime smoke-test (`harness_verify_runtime`). */
export interface HarnessRuntimeVerification {
  authenticated: boolean;
  errorMessage?: string;
  installed: boolean;
  outputPreview?: string;
  requiresDesktopRuntime?: boolean;
  version?: string;
}

/** Smoke-test a harness end to end — a live run with a trivial prompt that
 * confirms its install + credential work. Desktop-only; returns the
 * requires-desktop fallback in a browser preview. */
export async function verifyHarnessRuntime(
  harnessId: string,
): Promise<HarnessRuntimeVerification> {
  if (!isTauriRuntime()) {
    return {
      authenticated: false,
      errorMessage: DESKTOP_RUNTIME_REQUIRED,
      installed: false,
      requiresDesktopRuntime: true,
    };
  }
  return invoke<HarnessRuntimeVerification>("harness_verify_runtime", { harnessId });
}
