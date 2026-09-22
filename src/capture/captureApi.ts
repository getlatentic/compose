/** What the quick-note window asks of the app, behind one seam so it can be tested. */

import type { ClipboardAccess } from "../lib/ipc/clipboardClient";

export type { ClipboardAccess };

/** The part of the window a shortcut opens. */
export type QuickNoteView = "notes" | "clipboard";

export interface QuickNote {
  id: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export type ClipboardKind = "text" | "link" | "image" | "files";

/** A clipboard history entry as the list shows it: the start of its text. */
export interface ClipboardSummary {
  id: string;
  kind: ClipboardKind;
  preview: string;
  characters: number;
  /** It came with formatting that pastes as Markdown. */
  rich: boolean;
  sourceName: string | null;
  copiedAt: number;
  pinned: boolean;
}

/** An entry with everything it holds. */
export interface ClipboardEntry {
  id: string;
  kind: ClipboardKind;
  text: string;
  html: string | null;
  imageDataUrl: string | null;
}

export interface ClipboardHistory {
  enabled: boolean;
  access: ClipboardAccess;
  items: ClipboardSummary[];
}

export interface ClipboardApi {
  history(query: string): Promise<ClipboardHistory>;
  setEnabled(enabled: boolean): Promise<boolean>;
  entry(id: string): Promise<ClipboardEntry | null>;
  /** Puts what was picked back on the clipboard, to paste in any app: several as one text. */
  copy(ids: string[]): Promise<void>;
  pin(id: string, pinned: boolean): Promise<void>;
  forget(id: string): Promise<void>;
  clear(): Promise<void>;
  /** Opens the macOS setting that lets Compose read what other apps copy. */
  openPrivacySettings(): Promise<void>;
  /** Calls back each time a new copy is kept, or what macOS allows changes. */
  onChanged(callback: () => void): Promise<() => void>;
}

export interface CaptureApi {
  notes(): Promise<QuickNote[]>;
  keepNote(id: string, body: string): Promise<QuickNote>;
  deleteNote(id: string): Promise<void>;
  keepImage(id: string, relativePath: string, bytes: Uint8Array): Promise<void>;
  /** Where note `id`'s pasted images are, for showing them. */
  noteFolder(id: string): Promise<string>;
  /** Saves note `id` into the workspace and closes the window; `false` for blank text. */
  save(id: string, text: string): Promise<boolean>;
  close(): Promise<void>;
  /** The workspace a note goes to, or `null` when none is open. */
  destination(): Promise<string | null>;
  /** Calls back each time the window comes on screen, with the part to show. */
  onShown(callback: (view: QuickNoteView) => void): Promise<() => void>;
  clipboard: ClipboardApi;
}

interface CapturedNote {
  workspaceId: string;
  relativePath: string;
}

interface CaptureDestination {
  workspaceId: string;
  name: string;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}

async function listen<T>(event: string, callback: (payload: T) => void): Promise<() => void> {
  const { listen: tauriListen } = await import("@tauri-apps/api/event");
  return tauriListen<T>(event, (received) => callback(received.payload));
}

export const tauriCaptureApi: CaptureApi = {
  notes: () => invoke("quick_notes"),
  keepNote: (id, body) => invoke("quick_note_keep", { id, body }),
  deleteNote: (id) => invoke("quick_note_delete", { id }),
  // The IPC serializer carries bytes as a number array, which arrives as Vec<u8>.
  keepImage: (id, relativePath, bytes) => invoke("quick_note_keep_image", { id, relativePath, bytes: Array.from(bytes) }),
  noteFolder: (id) => invoke("quick_note_folder", { id }),
  async save(id, text) {
    return (await invoke<CapturedNote | null>("capture_save", { id, text })) !== null;
  },
  close: () => invoke("capture_close"),
  async destination() {
    return (await invoke<CaptureDestination | null>("capture_destination"))?.name ?? null;
  },
  onShown: (callback) => listen<{ view: QuickNoteView }>("capture:shown", (shown) => callback(shown?.view ?? "notes")),
  clipboard: {
    history: (query) => invoke("clipboard_history", { query }),
    setEnabled: (enabled) => invoke("clipboard_set_enabled", { enabled }),
    entry: (id) => invoke("clipboard_entry", { id }),
    copy: (ids) => invoke("clipboard_copy", { ids }),
    pin: (id, pinned) => invoke("clipboard_pin", { id, pinned }),
    forget: (id) => invoke("clipboard_forget", { id }),
    clear: () => invoke("clipboard_clear"),
    openPrivacySettings: () => invoke("clipboard_privacy_settings"),
    onChanged: (callback) => listen<null>("clipboard:changed", () => callback()),
  },
};
