import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime, requireDesktop } from "../runtime/desktopRuntime";

/** Whether Compose's Finder extension is on; `null` when this copy has none. */
export async function finderExtensionEnabled(): Promise<boolean | null> {
  if (!isTauriRuntime()) return null;
  return invoke<boolean | null>("finder_extension_enabled");
}

/** Open the System Settings pane where the Finder extension is turned on. */
export async function openFinderExtensionSettings(): Promise<void> {
  requireDesktop("The Finder extension");
  await invoke("finder_extension_settings");
}
