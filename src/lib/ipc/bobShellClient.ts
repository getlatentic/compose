/**
 * Browser-side client for the `bob` CLI bridge.
 *
 * Two transports:
 *   * **Vite dev middleware (default in browser preview)** —
 *     POSTs to `/api/bob/run` and streams Server-Sent Events
 *     back. The Vite middleware (`vite-plugins/bobProxy.ts`)
 *     spawns the real `bob` binary server-side with the
 *     `BOBSHELL_API_KEY` from `.env`. The key never reaches
 *     this code.
 *   * **Tauri desktop (planned)** — will route through the
 *     existing `harnessClient.ts` IPC. For now the browser path is
 *     used in both modes since `pnpm tauri dev` is also exposed
 *     to the same Vite middleware via its devUrl.
 *
 * Both paths produce the same `BobEvent` stream — JSON objects
 * straight out of `bob --output-format stream-json`, with one
 * synthesized terminal event (`end`).
 */

import { isTauriRuntime } from "../runtime/desktopRuntime";

export type BobChatMode = "ask" | "code" | "plan" | "advanced";

/**
 * Events emitted by `POST /api/bob/install`. The browser uses them
 * to render a progress log + decide when to re-run `/api/bob/check`.
 */
export type BobInstallEvent =
  /** Streamed checkpoint. `text` is human-readable, not parseable. */
  | { kind: "step"; text: string }
  /** Live stdout from the install script. Tail in the UI. */
  | { kind: "stdout"; text: string }
  /** Live stderr (npm warnings, curl progress). */
  | { kind: "stderr"; text: string }
  /** Terminal event. `ok` mirrors `exitCode === 0`. */
  | { kind: "done"; exitCode: number | null; ok: boolean };

/**
 * Run the install script and stream `BobInstallEvent`s as it
 * progresses. Routes by runtime:
 *
 *   * **Tauri** → `invoke('settings_install_bob', { onEvent })`
 *     with a Tauri `Channel`. The Rust side embeds the same
 *     `scripts/install-bob.sh` via `include_str!` so both runtimes
 *     execute byte-identical scripts.
 *   * **Browser-dev** → `POST /api/bob/install` over SSE.
 *
 * Generator completes when the install process exits or the
 * transport closes. After the terminal `done` event, callers
 * should re-run `checkBobInstall()` to refresh PATH state.
 */
export async function* installBob(opts: {
  signal?: AbortSignal;
} = {}): AsyncGenerator<BobInstallEvent, void, void> {
  if (isTauriRuntime()) {
    yield* installBobViaTauri(opts);
    return;
  }
  yield* installBobViaProxy(opts);
}

/**
 * Tauri install path. Uses a `Channel` so each `InstallEvent`
 * dispatched on the Rust side fires `channel.onmessage` here.
 * Bridged to an async-iterable shape via a small in-memory queue
 * + Promise resolution so callers can `for await` on the events.
 */
async function* installBobViaTauri(_opts: {
  signal?: AbortSignal;
}): AsyncGenerator<BobInstallEvent, void, void> {
  // Lazy import to keep `@tauri-apps/api/core` out of the browser-
  // dev bundle (Vite tree-shakes via the dynamic import). The
  // module exists either way — it's just dead code in browser-dev.
  const { Channel, invoke } = await import("@tauri-apps/api/core");

  type RustInstallEvent =
    | { kind: "step"; text: string }
    | { kind: "stdout"; text: string }
    | { kind: "stderr"; text: string }
    | { kind: "done"; exitCode: number | null; ok: boolean };

  const channel = new Channel<RustInstallEvent>();
  const queue: BobInstallEvent[] = [];
  let pendingResolve: ((value: void) => void) | null = null;
  let finished = false;

  channel.onmessage = (event) => {
    queue.push(event satisfies BobInstallEvent);
    if (event.kind === "done") {
      finished = true;
    }
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      r();
    }
  };

  // Fire the command but don't await — we yield events as they
  // arrive on the channel. The invoke resolves once Rust returns
  // from the command (after the child exits + final `done` send).
  // If invoke errors, surface as a synthesized stderr + done.
  const invokePromise = invoke<void>("settings_install_bob", { onEvent: channel })
    .catch((err) => {
      queue.push({ kind: "stderr", text: String(err) });
      queue.push({ kind: "done", exitCode: null, ok: false });
      finished = true;
      if (pendingResolve) {
        const r = pendingResolve;
        pendingResolve = null;
        r();
      }
    });

  while (true) {
    while (queue.length > 0) {
      const event = queue.shift()!;
      yield event;
      if (event.kind === "done") {
        await invokePromise; // ensure the command resolved cleanly
        return;
      }
    }
    if (finished) {
      await invokePromise;
      return;
    }
    // Wait for the next channel message.
    await new Promise<void>((resolve) => {
      pendingResolve = resolve;
    });
  }
}

/**
 * Browser-dev SSE install path. Identical event sequence to the
 * Tauri channel above so callers can treat both as opaque.
 */
async function* installBobViaProxy(opts: {
  signal?: AbortSignal;
}): AsyncGenerator<BobInstallEvent, void, void> {
  const response = await fetch("/api/bob/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    signal: opts.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    yield { kind: "stderr", text: `install proxy returned ${response.status}: ${text}` };
    yield { kind: "done", exitCode: null, ok: false };
    return;
  }
  if (!response.body) {
    yield { kind: "stderr", text: "install proxy returned no body" };
    yield { kind: "done", exitCode: null, ok: false };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let blankIdx = buffer.indexOf("\n\n");
      while (blankIdx !== -1) {
        const block = buffer.slice(0, blankIdx);
        buffer = buffer.slice(blankIdx + 2);
        const event = parseInstallSseBlock(block);
        if (event) yield event;
        blankIdx = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseInstallSseBlock(block: string): BobInstallEvent | null {
  let eventName = "message";
  let dataLines: string[] = [];
  for (const raw of block.split("\n")) {
    if (raw.startsWith("event:")) eventName = raw.slice(6).trim();
    else if (raw.startsWith("data:")) dataLines.push(raw.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(dataLines.join("\n"));
  } catch {
    return null;
  }
  const text =
    typeof payload === "object" && payload !== null && "text" in payload
      ? String((payload as { text: unknown }).text ?? "")
      : "";
  switch (eventName) {
    case "install.step":
      return { kind: "step", text };
    case "install.stdout":
      return { kind: "stdout", text };
    case "install.stderr":
      return { kind: "stderr", text };
    case "install.done": {
      const exitCode =
        typeof payload === "object" && payload !== null && "exitCode" in payload
          ? ((payload as { exitCode: number | null }).exitCode ?? null)
          : null;
      const ok =
        typeof payload === "object" && payload !== null && "ok" in payload
          ? Boolean((payload as { ok: unknown }).ok)
          : exitCode === 0;
      return { kind: "done", exitCode, ok };
    }
    case "ready":
      // No corresponding caller-visible kind; ignore.
      return null;
    default:
      return null;
  }
}

/**
 * Event shapes match the bob CLI's `--output-format stream-json`
 * output. See `bob-agents/apps/api/tests/test_rust_bob_direct.py`
 * for the canonical list — replicated here as a union for the
 * common shapes we care about. Anything else surfaces as
 * `BobEvent` with the raw `type` so the UI can show "unknown".
 */
export type BobEvent =
  | { kind: "ready"; runId: string }
  | { kind: "init"; sessionId?: string; model?: string }
  /** Streaming assistant deltas. `delta: true` means content
   *  is a partial chunk to append to the running response. */
  | { kind: "message"; role: "user" | "assistant"; content: string; delta: boolean }
  | { kind: "tool_use"; toolName: string; parameters: Record<string, unknown>; toolId?: string }
  | { kind: "tool_result"; status: string; output?: string; toolId?: string }
  /** Synthesized by the parser when a `tool_use` event arrives
   *  with `tool_name === "attempt_completion"`. The bob CLI
   *  always wraps its final answer in this tool call; reading
   *  `parameters.result` is how you get the canonical reply. */
  | { kind: "attempt_completion"; text: string }
  | { kind: "result"; status: string; stats?: Record<string, unknown> }
  | { kind: "stderr"; text: string }
  | { kind: "error"; message: string }
  | { kind: "end"; exitCode: number | null; runId?: string }
  | { kind: "unknown"; type: string; payload: unknown };

export interface BobRunOptions {
  prompt: string;
  mode?: BobChatMode;
  maxCoins?: number;
  /**
   * Working directory for the bob CLI. Defaults to whatever the
   * Vite dev server is running in (the repo root).
   * For workspace-scoped runs, pass the workspace path.
   */
  cwd?: string;
  /**
   * AbortSignal for cancelling an in-flight run. The middleware
   * will SIGTERM the bob child when the SSE connection closes.
   */
  signal?: AbortSignal;
}

/**
 * Start a bob run. Returns an async iterable that yields events
 * as they arrive. The iterable completes when bob emits its
 * `result` event or the connection closes.
 *
 * Usage:
 * ```ts
 * for await (const event of streamBob({ prompt: "...", mode: "ask" })) {
 *   if (event.kind === "attempt_completion") {
 *     setResponseText(event.text ?? event.result ?? "");
 *   }
 * }
 * ```
 */
export async function* streamBob(opts: BobRunOptions): AsyncGenerator<BobEvent, void, void> {
  const response = await fetch("/api/bob/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: opts.prompt,
      mode: opts.mode ?? "ask",
      maxCoins: opts.maxCoins ?? 30,
      cwd: opts.cwd,
    }),
    signal: opts.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    yield {
      kind: "error",
      message: `bob proxy returned ${response.status}: ${text}`,
    };
    return;
  }
  if (!response.body) {
    yield { kind: "error", message: "bob proxy returned no body" };
    return;
  }

  // Parse the SSE stream manually. We don't use `EventSource`
  // because it's GET-only — we need POST for the prompt body.
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by blank lines.
      let blankIdx = buffer.indexOf("\n\n");
      while (blankIdx !== -1) {
        const block = buffer.slice(0, blankIdx);
        buffer = buffer.slice(blankIdx + 2);
        const event = parseSseBlock(block);
        if (event) {
          yield event;
        }
        blankIdx = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Convenience: run bob, accumulate text from `attempt_completion`
 * and `text` events, and return it as a single string when bob
 * emits its terminal `result` or `end` event.
 *
 * Used by the Edit flow ("apply this change to my selection")
 * where we don't need to stream tokens into a UI — we wait for
 * the final answer and substitute it.
 */
export async function runBobAndCollect(opts: BobRunOptions): Promise<string> {
  // The `attempt_completion` tool call carries the canonical
  // final answer. We prefer that when it lands, and fall back
  // to accumulating message deltas only if it doesn't (which
  // would be unusual for `ask` mode but defensive against
  // future protocol drift).
  let finalAnswer: string | null = null;
  let accumulated = "";
  for await (const event of streamBob(opts)) {
    if (event.kind === "attempt_completion") {
      finalAnswer = event.text;
    } else if (event.kind === "message" && event.role === "assistant" && event.delta) {
      // Skip the special "[using tool ...]" status lines bob
      // emits as deltas alongside the real content. They start
      // with "[using tool" — not part of the answer.
      if (!event.content.startsWith("[using tool")) {
        accumulated += event.content;
      }
    } else if (event.kind === "error") {
      throw new Error(event.message);
    }
  }
  return (finalAnswer ?? accumulated).trim();
}

function parseSseBlock(block: string): BobEvent | null {
  let eventName = "message";
  let dataLines: string[] = [];
  for (const raw of block.split("\n")) {
    if (raw.startsWith("event:")) {
      eventName = raw.slice(6).trim();
    } else if (raw.startsWith("data:")) {
      dataLines.push(raw.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;
  const dataText = dataLines.join("\n");
  let payload: unknown;
  try {
    payload = JSON.parse(dataText);
  } catch {
    return { kind: "stderr", text: dataText };
  }

  switch (eventName) {
    case "ready":
      return {
        kind: "ready",
        runId: getString(payload, "runId") ?? "",
      };
    case "bob.init":
      return {
        kind: "init",
        sessionId: getString(payload, "session_id") ?? getString(payload, "sessionId"),
        model: getString(payload, "model"),
      };
    case "bob.tool_use": {
      const toolName = getString(payload, "tool_name") ?? "";
      const parameters =
        typeof payload === "object" && payload !== null && "parameters" in payload
          ? ((payload as { parameters: Record<string, unknown> }).parameters ?? {})
          : {};
      // The bob CLI always emits the final answer through the
      // `attempt_completion` tool — `parameters.result` is the
      // canonical reply text. Surface it as its own event kind
      // so callers can read `event.text` without poking at the
      // tool_use details.
      if (toolName === "attempt_completion") {
        const result = parameters["result"];
        if (typeof result === "string") {
          return { kind: "attempt_completion", text: result };
        }
      }
      return {
        kind: "tool_use",
        toolName,
        parameters,
        toolId: getString(payload, "tool_id"),
      };
    }
    case "bob.tool_result":
      return {
        kind: "tool_result",
        status: getString(payload, "status") ?? "",
        output: getString(payload, "output"),
        toolId: getString(payload, "tool_id"),
      };
    case "bob.message": {
      const role = getString(payload, "role");
      const content = getString(payload, "content");
      if (content == null || (role !== "user" && role !== "assistant")) {
        return null;
      }
      const delta =
        typeof payload === "object"
        && payload !== null
        && "delta" in payload
        && Boolean((payload as { delta: unknown }).delta);
      return { kind: "message", role, content, delta };
    }
    case "bob.result":
      return {
        kind: "result",
        status: getString(payload, "status") ?? "",
        stats:
          typeof payload === "object" && payload !== null && "stats" in payload
            ? ((payload as { stats: Record<string, unknown> }).stats ?? undefined)
            : undefined,
      };
    case "bob.stderr":
      return { kind: "stderr", text: getString(payload, "text") ?? "" };
    case "bob.error":
      return { kind: "error", message: getString(payload, "message") ?? "Unknown bob error" };
    case "end":
      return {
        kind: "end",
        exitCode:
          typeof payload === "object" && payload !== null && "exitCode" in payload
            ? ((payload as { exitCode: number | null }).exitCode ?? null)
            : null,
        runId: getString(payload, "runId"),
      };
    default:
      return {
        kind: "unknown",
        type: eventName,
        payload,
      };
  }
}

function getString(payload: unknown, key: string): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
