import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime, requireDesktop } from "../runtime/desktopRuntime";

/** Whether Compose adds its notes to Spotlight on this Mac. */
export async function spotlightEnabled(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return invoke<boolean>("spotlight_enabled");
}

/** Turning it off removes every note Compose added. */
export async function setSpotlightEnabled(enabled: boolean): Promise<boolean> {
  requireDesktop("Spotlight");
  return invoke<boolean>("spotlight_set_enabled", { enabled });
}
