import { invoke } from "@tauri-apps/api/core";

/** The global shortcut that opens quick capture: `current` is `null` once the
 *  user turned it off; `default` is what it starts as. */
export interface CaptureShortcut {
  current: string | null;
  default: string;
}

export async function captureShortcut(): Promise<CaptureShortcut> {
  return invoke<CaptureShortcut>("capture_shortcut");
}

/** Rejects, keeping the old shortcut, when the system will not register the
 *  new one. */
export async function setCaptureShortcut(shortcut: string | null): Promise<CaptureShortcut> {
  return invoke<CaptureShortcut>("capture_set_shortcut", { shortcut });
}
