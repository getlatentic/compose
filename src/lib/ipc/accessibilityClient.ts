import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "../runtime/desktopRuntime";

/** Whether "Reduce transparency" or "Increase contrast" asks for a solid window frame. Never outside the Compose app. */
export async function solidWindowFrame(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  return invoke<boolean>("solid_window_frame");
}
