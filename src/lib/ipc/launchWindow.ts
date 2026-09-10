import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";

/**
 * Tell the native side the first screen is complete, so it can show the window.
 *
 * The window is created hidden: a web view cannot paint until its bundle has
 * rendered, and a window visible before then has to show something in the
 * meantime. Rust shows it on its own deadline regardless, so a failure here
 * costs the launch nothing but the wait.
 */
export async function markLaunchWindowReady(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  try {
    await invoke("launch_window_ready", { reason: "app" });
  } catch {
    // The deadline on the Rust side is the guarantee, not this call.
  }
}
