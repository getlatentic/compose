import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "../runtime/desktopRuntime";

let families: Promise<string[]> | null = null;

/**
 * The Mac's installed font families (`system_font_families`), read once per
 * session; none outside Compose. A failed read is retried next time.
 */
export function loadInstalledFamilies(): Promise<string[]> {
  if (!isTauriRuntime()) return Promise.resolve([]);
  families ??= invoke<string[]>("system_font_families").catch(() => {
    families = null;
    return [];
  });
  return families;
}
