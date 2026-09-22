import { invoke } from "@tauri-apps/api/core";

/** Whether Compose keeps what the user copies. */
export async function clipboardHistoryEnabled(): Promise<boolean> {
  return (await invoke<{ enabled: boolean }>("clipboard_history", { query: "" })).enabled;
}

export async function setClipboardHistoryEnabled(enabled: boolean): Promise<boolean> {
  return invoke<boolean>("clipboard_set_enabled", { enabled });
}

/** Forget every copy but the pinned ones. */
export async function clearClipboardHistory(): Promise<void> {
  await invoke("clipboard_clear");
}
