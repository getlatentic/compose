export function isTauriRuntime() {
  if (typeof window === "undefined") {
    return false;
  }

  return "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

/**
 * For an action only the Compose app can do: outside it (the browser
 * preview) it fails with a message saying so, before any IPC.
 */
export function requireDesktop(what: string): void {
  if (!isTauriRuntime()) throw new Error(`${what} is available in the Compose app.`);
}
