import { invoke } from "@tauri-apps/api/core";

/** Whether Compose's Finder extension is on; `null` when this copy has none. */
export async function finderExtensionEnabled(): Promise<boolean | null> {
  return invoke<boolean | null>("finder_extension_enabled");
}

/** Open the System Settings pane where the Finder extension is turned on. */
export async function openFinderExtensionSettings(): Promise<void> {
  await invoke("finder_extension_settings");
}
