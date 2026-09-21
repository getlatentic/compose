/** What the capture page asks of the app, behind one seam so it can be tested. */
export interface CaptureApi {
  /** Saves the text as a new note and closes the window; `false` for blank text. */
  save(text: string): Promise<boolean>;
  close(): Promise<void>;
  /** The workspace a capture goes to, or `null` when none is open. */
  destination(): Promise<string | null>;
  /** Calls back each time the window comes on screen. */
  onShown(callback: () => void): Promise<() => void>;
}

interface CapturedNote {
  workspaceId: string;
  relativePath: string;
}

interface CaptureDestination {
  workspaceId: string;
  name: string;
}

export const tauriCaptureApi: CaptureApi = {
  async save(text) {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<CapturedNote | null>("capture_save", { text })) !== null;
  },
  async close() {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("capture_close");
  },
  async destination() {
    const { invoke } = await import("@tauri-apps/api/core");
    return (await invoke<CaptureDestination | null>("capture_destination"))?.name ?? null;
  },
  async onShown(callback) {
    const { listen } = await import("@tauri-apps/api/event");
    return listen("capture:shown", callback);
  },
};
