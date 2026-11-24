import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";
import { DESKTOP_RUNTIME_REQUIRED } from "./harnessRunClient";

/**
 * Setting an agent up: its key, signing in, and installing it.
 */

/** Streamed install events (shared shape with the bob installer). */
export type HarnessInstallEvent =
  | { kind: "step"; text: string }
  | { kind: "stdout"; text: string }
  | { kind: "stderr"; text: string }
  | { kind: "done"; exitCode: number | null; ok: boolean };

/**
 * Store a harness's API key in the OS keychain (and export it into the env so it
 * takes effect immediately). An empty value clears it. Works for any harness id
 * including bob — the Rust side routes bob's key through bob-rs.
 */
export async function harnessSetCredential(harnessId: string, value: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke<void>("harness_set_credential", { harnessId, value });
}

/** Whether a harness's API key is stored (or none is needed). */
export interface HarnessCredentialStatus {
  configured: boolean;
  /** `sk-or…9f2c` — enough to recognise WHICH key is stored, never enough to
   *  use it. Absent when nothing is stored, or the value was too short to
   *  show any of safely. */
  hint?: string | null;
}

/** Read whether a harness's API key is stored (or none is needed). */
export async function harnessCredentialStatus(
  harnessId: string,
): Promise<HarnessCredentialStatus> {
  if (!isTauriRuntime()) {
    return { configured: false };
  }
  return invoke<HarnessCredentialStatus>("harness_credential_status", { harnessId });
}

/**
 * Bridge a streaming subprocess Tauri command onto an async generator: yields
 * each `HarnessInstallEvent` as it arrives on the `Channel`, resolves when the
 * process exits (`done`). Shared by `harnessInstall`, `harnessLogin`, and the
 * system dependency installer — all are "spawn a process, stream its output,
 * wait for exit," so they share one channel-bridging loop. `payload` is merged
 * into the invoke args alongside the `onEvent` channel.
 */
export async function* streamSubprocessCommand(
  command: string,
  payload: Record<string, unknown>,
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
  const invokePromise = invoke<void>(command, { ...payload, onEvent: channel }).catch((err) => {
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
 * Stream a harness's interactive sign-in (claude/codex OAuth). The CLI
 * opens the user's browser; this yields progress and resolves when it
 * exits with a `done` carrying success. Same event shape as install.
 */
export function harnessLogin(harnessId: string): AsyncGenerator<HarnessInstallEvent, void, void> {
  return streamSubprocessCommand("harness_login", { harnessId });
}
