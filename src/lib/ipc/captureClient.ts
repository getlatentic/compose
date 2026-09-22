import { invoke } from "@tauri-apps/api/core";

/** The part of the quick-note window a shortcut opens. */
export type QuickNoteView = "notes" | "clipboard";

/** A global shortcut that opens the quick-note window: `current` is `null` once
 *  the user turned it off; `default` is what it starts as. */
export interface CaptureShortcut {
  current: string | null;
  default: string;
}

export interface CaptureShortcuts {
  notes: CaptureShortcut;
  clipboard: CaptureShortcut;
}

export async function captureShortcuts(): Promise<CaptureShortcuts> {
  return invoke<CaptureShortcuts>("capture_shortcuts");
}

/** Rejects, keeping the old shortcuts, when the system will not register the
 *  new one or it is the other view's. */
export async function setCaptureShortcut(view: QuickNoteView, shortcut: string | null): Promise<CaptureShortcuts> {
  return invoke<CaptureShortcuts>("capture_set_shortcut", { view, shortcut });
}
