import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "../runtime/desktopRuntime";

/**
 * Erase all Compose data — workspaces, conversations, settings, and saved keys —
 * and restart into a fresh first-run. Note files on disk are untouched. The app
 * relaunches itself, so on success this never resolves.
 */
export async function resetAllData(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke<void>("app_reset_all_data");
}
