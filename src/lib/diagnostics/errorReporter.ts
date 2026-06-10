import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";

/**
 * Local error capture. Uncaught front-end errors, unhandled rejections, and
 * failed agent runs are appended to a local log file (`compose::logging`) the
 * user can attach to a bug report. **Local-only — nothing is sent anywhere**,
 * so there's no consent to ask for. In the browser preview it just logs to the
 * console.
 */

/** Append one entry to the local error log. Never throws — logging must not
 * itself become a failure path. */
export async function reportClientError(
  kind: string,
  message: string,
  detail?: string,
): Promise<void> {
  if (!isTauriRuntime()) {
    console.error(`[${kind}] ${message}`, detail ?? "");
    return;
  }
  try {
    await invoke("report_client_error", { kind, message, detail: detail ?? null });
  } catch {
    /* swallow — the reporter can't be allowed to throw */
  }
}

let installed = false;

/** Install global handlers for uncaught errors + unhandled promise rejections.
 * Idempotent; call once at startup. */
export function installGlobalErrorReporter(): void {
  if (installed || typeof window === "undefined") {
    return;
  }
  installed = true;
  window.addEventListener("error", (event) => {
    const message = event.message || String(event.error ?? "unknown error");
    const detail = errorStack(event.error) ?? `${event.filename}:${event.lineno}:${event.colno}`;
    void reportClientError("uncaught", message, detail);
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reasonMessage(reason);
    void reportClientError("unhandledRejection", message, errorStack(reason));
  });
}

/** Reveal the error log in the OS file manager so the user can attach it.
 * Returns its path (or null in the browser). */
export async function revealErrorLog(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const path = await invoke<string>("open_error_log");
  try {
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(path);
  } catch {
    /* revealing is best-effort; the path is still returned */
  }
  return path;
}

function errorStack(value: unknown): string | undefined {
  return value instanceof Error ? value.stack : undefined;
}

function reasonMessage(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message;
  }
  return typeof reason === "string" ? reason : String(reason);
}
