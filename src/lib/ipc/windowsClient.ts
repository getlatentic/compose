import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";

/**
 * Open a fresh Compose window. The new window has its own JS context — so its
 * own Zustand store — and boots into the no-workspace welcome. Returns the
 * Tauri label so the caller can correlate per-window events (run streams etc).
 *
 * Browser preview: a no-op returning a synthetic label. The "new window"
 * affordance only makes sense in the desktop build.
 */
export async function openNewComposeWindow(): Promise<string> {
  if (!isTauriRuntime()) {
    // Browser preview: pop a new tab — the closest equivalent.
    if (typeof window !== "undefined" && typeof window.open === "function") {
      window.open(window.location.href, "_blank", "noopener");
    }
    return "browser-noop";
  }
  return invoke<string>("open_new_window");
}
