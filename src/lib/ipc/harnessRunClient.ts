import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";

/**
 * Running an agent: the request, the events its run streams back, and cancelling it.
 */

export type ChatMode = "plan" | "code" | "advanced" | "ask";

export type ApprovalMode = "default" | "auto_edit";

/** Harness-neutral reasoning-effort levels (Codex's
 * `model_reasoning_effort`). Mirrors `compose_core::ReasoningEffort`. */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/**
 * How a run's edits are guarded, chosen per harness from its capabilities +
 * the user's "review edits" toggle. Mirrors `compose::review::EditGuard`.
 * - `none`: the harness reviews its own edits (bob) — no gate.
 * - `snapshot`: direct edits, but a baseline is recorded first so they undo.
 * - `clone`: run against a sandbox; the user approves the diff before anything
 *   touches their files.
 */
export type EditGuard = "none" | "snapshot" | "clone";

/** A file a `clone` run's sandbox starts with in place of the real one; `content: null` deletes it. */
export interface SandboxFile {
  relativePath: string;
  content: string | null;
}

export interface HarnessRunRequest {
  approvalMode: ApprovalMode;
  chatMode: ChatMode;
  contextFilePaths?: string[];
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
  /**
   * How this run's edits should be guarded. Omitted → the Rust side defaults
   * to `none` (bob). The frontend sets `clone` / `snapshot` for write-capable
   * harnesses depending on the user's review toggle.
   */
  editGuard?: EditGuard;
  /**
   * For a `clone` run: earlier runs' proposals the writer has not decided yet,
   * written into the sandbox so the agent starts from what its conversation
   * says it did. See `features/review/waitingProposals.ts`.
   */
  sandboxFiles?: readonly SandboxFile[];
  /**
   * Extra CLI args appended verbatim to the harness's argv (via
   * `RunTuning.extra_args`). The frontend builds these from per-harness config
   * — e.g. the permission-mode setting — so run policy stays host-side and
   * configurable, not hardcoded in the adapter. Omitted/empty → adapter defaults.
   */
  extraArgs?: string[];
  /**
   * The user's per-harness "custom instructions", appended to the system prompt
   * via `RunTuning.extra_instructions`. Honored by the openai-compatible adapter
   * (Ollama / OpenRouter); ignored by the CLI harnesses. Omitted/empty → none.
   */
  extraInstructions?: string;
  /**
   * Absolute path to the agent's executable, pinning the run to a specific vetted
   * binary instead of resolving the bare CLI name on PATH (the Runtimes panel's
   * "Set explicit path"). Threaded to the adapter via `RunTuning.binary_path`;
   * the CLI harnesses spawn it, the openai-compatible adapter ignores it.
   * Omitted/empty → PATH resolution. See `compose_core::RunTuning`.
   */
  binaryPath?: string;
}

/**
 * A raw suggested edit on the wire. Structurally matches the app's
 * `SuggestedEditInput` except `title` is omitted (vs `null`) when
 * absent — the store maps `title ?? null` when handing it to
 * `prepareWorkspaceSuggestionDrafts`. Defined here (not imported from
 * the app layer) so the IPC client stays a leaf with no upward dep.
 */
export interface HarnessRunSuggestedEdit {
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
/**
 * Neutral, cross-harness classification of what a tool call does — sourced
 * from the harness adapter (agent-harness `ToolKind`), never re-derived from
 * the tool `name` downstream. The UI routes on this: `read` → a context pill,
 * `write`/`edit` → a file-op card.
 */
export type ToolKind = "read" | "write" | "edit" | "search" | "execute" | "other";

export type HarnessRunEvent =
  | { kind: "started"; runId: string }
  /** A chunk of the *answer* → the message bubble. For bob this is only
   * the `attempt_completion` result; for Claude/Codex the streamed text. */
  | { kind: "text"; runId: string; delta: string }
  /** Process narration ("what I'm doing") → live status + trace. Not the
   * answer. bob's plain assistant messages; Claude/Codex don't emit it. */
  | { kind: "notice"; runId: string; message: string }
  | { kind: "thinking"; runId: string; delta: string }
  | {
      kind: "toolStart";
      runId: string;
      toolCallId: string;
      name: string;
      input: string | null;
      toolKind: ToolKind;
    }
  | { kind: "toolEnd"; runId: string; toolCallId: string; ok: boolean; output: string | null }
  /** Harness session identity (bob's `init`) → trace. */
  | { kind: "session"; runId: string; sessionId: string; model: string | null }
  | { kind: "suggestedEdits"; runId: string; edits: HarnessRunSuggestedEdit[] }
  | { kind: "activity"; runId: string; message: string }
  /** Terminal usage stats (bob's `result.stats`) → stats float. */
  | {
      kind: "usage";
      runId: string;
      totalTokens: number | null;
      toolCalls: number | null;
      coins: number | null;
    }
  | { kind: "error"; runId: string; message: string }
  | { kind: "exited"; runId: string; exitCode: number | null; cancelled: boolean };

const HARNESS_RUN_EVENT = "harness_run";

export const DESKTOP_RUNTIME_REQUIRED =
  "Streaming a harness run requires the Tauri desktop runtime. Browser preview can't run agents.";

export async function runHarnessStream(request: HarnessRunRequest): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_RUNTIME_REQUIRED);
  }
  await invoke<void>("run_harness_stream", { request });
}

/**
 * Spill a large chat message to a scratch file the harness `read` tool can fetch
 * on demand, returning its absolute path. Lets a big paste stay out of the first
 * turn's inline prompt so it can't blow a small model's context window. Throws in
 * the browser preview — the caller only invokes it on the desktop send path.
 */
export async function spillChatInput(workspaceId: string, text: string): Promise<string> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_RUNTIME_REQUIRED);
  }
  return invoke<string>("spill_chat_input", { workspaceId, text });
}

export async function cancelHarnessRun(runId: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error(DESKTOP_RUNTIME_REQUIRED);
  }
  await invoke<void>("cancel_harness_run", { runId });
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
