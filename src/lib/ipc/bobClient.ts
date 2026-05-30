import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";

export type BobChatMode = "plan" | "code" | "advanced" | "ask";
export type BobApprovalMode = "default" | "auto_edit";
/** Harness-neutral reasoning-effort levels (Codex's
 * `model_reasoning_effort`). Mirrors `compose_core::ReasoningEffort`. */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface HarnessRunRequest {
  approvalMode: BobApprovalMode;
  chatMode: BobChatMode;
  contextFilePaths?: string[];
  maxCoins: number;
  prompt: string;
  runId: string;
  workspaceId: string;
  /**
   * Which harness to run. Omitted → the Rust side defaults to
   * `"bob"` (bob's richer Tauri path). The H5 picker sets this to
   * route a run to Claude Code / Codex / etc. through the registry.
   */
  harnessId?: string;
  /**
   * Per-harness run tuning from the Settings picker. Only the CLI
   * harnesses honor these (claude: model + maxTurns; codex: model +
   * effort); the bob branch ignores them. Omitted/empty → the CLI's
   * own default. See `compose_core::RunTuning`.
   */
  model?: string;
  effort?: ReasoningEffort;
  maxTurns?: number;
}

/** The default harness id when nothing is selected / the catalog is
 * unavailable. Mirrors `compose_core::DEFAULT_HARNESS_ID`. */
export const DEFAULT_HARNESS_ID = "bob";

/** A model the harness can be pointed at (mirrors
 * `compose_core::HarnessModel`). `value` is passed verbatim to the CLI. */
export interface HarnessModel {
  value: string;
  label: string;
}

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
  allowsCustomModel: boolean;
  /** Honors reasoning effort (codex). */
  supportsEffort: boolean;
  /** Honors a max-turns cap (claude). */
  supportsMaxTurns: boolean;
  /** Supports an interactive sign-in flow (claude/codex OAuth) the picker
   * can trigger when installed-but-not-signed-in. */
  supportsLogin: boolean;
}

/** One entry in the harness catalog (`harness_list` command). */
export interface HarnessInfo {
  id: string;
  displayName: string;
  description: string;
  requiresInstall: boolean;
  capabilities: HarnessCapabilities;
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

/** Streamed install events (shared shape with the bob installer). */
export type HarnessInstallEvent =
  | { kind: "step"; text: string }
  | { kind: "stdout"; text: string }
  | { kind: "stderr"; text: string }
  | { kind: "done"; exitCode: number | null; ok: boolean };

/**
 * A raw suggested edit on the wire. Structurally matches the app's
 * `BobSuggestedEditInput` except `title` is omitted (vs `null`) when
 * absent — the store maps `title ?? null` when handing it to
 * `prepareWorkspaceSuggestionDrafts`. Defined here (not imported from
 * the app layer) so the IPC client stays a leaf with no upward dep.
 */
export interface BobRunSuggestedEdit {
  filePath: string;
  range: { start: number; end: number };
  replacement: string;
  title?: string;
}

/**
 * The normalized run-event stream, emitted by `compose_core::RunEvent`
 * on the Rust side. bob's raw stream-json is parsed into these
 * variants by the harness adapter, so the front-end consumes one
 * harness-neutral vocabulary — it never parses a harness's wire
 * format. Adding a harness adds a Rust-side parser, not a TS branch.
 */
export type HarnessRunEvent =
  | { kind: "started"; runId: string }
  | { kind: "text"; runId: string; delta: string }
  | { kind: "thinking"; runId: string; delta: string }
  | { kind: "toolStart"; runId: string; toolCallId: string; name: string }
  | { kind: "toolEnd"; runId: string; toolCallId: string; ok: boolean }
  | { kind: "suggestedEdits"; runId: string; edits: BobRunSuggestedEdit[] }
  | { kind: "activity"; runId: string; message: string }
  | { kind: "error"; runId: string; message: string }
  | { kind: "exited"; runId: string; exitCode: number | null; cancelled: boolean };

const HARNESS_RUN_EVENT = "harness_run";
const DESKTOP_RUNTIME_REQUIRED =
  "Streaming a harness run requires the Tauri desktop runtime. Browser preview can't run agents.";

export async function runHarnessStream(request: HarnessRunRequest): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_RUNTIME_REQUIRED);
  }
  await invoke<void>("run_harness_stream", { request });
}

export async function cancelHarnessRun(runId: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_RUNTIME_REQUIRED);
  }
  await invoke<void>("cancel_harness_run", { runId });
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
  return invoke<HarnessInfo[]>("harness_list");
}

/** Probe one harness's readiness (installed / version / auth). */
export async function harnessReadiness(harnessId: string): Promise<HarnessReadiness | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  return invoke<HarnessReadiness>("harness_readiness", { harnessId });
}

/**
 * Bridge a streaming subprocess Tauri command (install or login) onto an
 * async generator: yields each `HarnessInstallEvent` as it arrives on the
 * `Channel`, resolves when the process exits (`done`). Shared by
 * `harnessInstall` and `harnessLogin` — both are "spawn a CLI, stream its
 * output, wait for exit," so they share one channel-bridging loop.
 */
async function* streamSubprocessCommand(
  command: "harness_install" | "harness_login",
  harnessId: string,
): AsyncGenerator<HarnessInstallEvent, void, void> {
  if (!isTauriRuntime()) {
    yield { kind: "stderr", text: DESKTOP_RUNTIME_REQUIRED };
    yield { kind: "done", exitCode: null, ok: false };
    return;
  }
  const { Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<HarnessInstallEvent>();
  const queue: HarnessInstallEvent[] = [];
  let pendingResolve: (() => void) | null = null;
  let finished = false;
  const wake = () => {
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      r();
    }
  };
  channel.onmessage = (event) => {
    queue.push(event);
    if (event.kind === "done") {
      finished = true;
    }
    wake();
  };
  const invokePromise = invoke<void>(command, { harnessId, onEvent: channel }).catch((err) => {
    queue.push({ kind: "stderr", text: String(err) });
    queue.push({ kind: "done", exitCode: null, ok: false });
    finished = true;
    wake();
  });
  while (true) {
    while (queue.length > 0) {
      const event = queue.shift()!;
      yield event;
      if (event.kind === "done") {
        await invokePromise;
        return;
      }
    }
    if (finished) {
      return;
    }
    await new Promise<void>((resolve) => {
      pendingResolve = resolve;
    });
  }
}

/**
 * Stream a harness's one-time install. Yields events as they arrive on a
 * Tauri `Channel`; resolves when the install process exits.
 */
export function harnessInstall(harnessId: string): AsyncGenerator<HarnessInstallEvent, void, void> {
  return streamSubprocessCommand("harness_install", harnessId);
}

/**
 * Stream a harness's interactive sign-in (claude/codex OAuth). The CLI
 * opens the user's browser; this yields progress and resolves when it
 * exits with a `done` carrying success. Same event shape as install.
 */
export function harnessLogin(harnessId: string): AsyncGenerator<HarnessInstallEvent, void, void> {
  return streamSubprocessCommand("harness_login", harnessId);
}

export async function subscribeHarnessRun(
  runId: string,
  handler: (event: HarnessRunEvent) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_RUNTIME_REQUIRED);
  }
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<HarnessRunEvent>(HARNESS_RUN_EVENT, (event) => {
    if (event.payload.runId === runId) {
      handler(event.payload);
    }
  });
  return unlisten;
}
