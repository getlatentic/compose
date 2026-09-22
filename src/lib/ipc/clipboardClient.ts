import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/**
 * What macOS lets Compose read of other apps' copies. Anything but `allowed`
 * keeps new copies out until the user allows Compose under Privacy & Security →
 * Paste from Other Apps.
 */
export type ClipboardAccess = "allowed" | "asks" | "denied";

export interface ClipboardHistoryStatus {
  enabled: boolean;
  access: ClipboardAccess;
}

/** Whether Compose keeps what the user copies, and whether macOS lets it read. */
export async function clipboardHistoryStatus(): Promise<ClipboardHistoryStatus> {
  const { enabled, access } = await invoke<ClipboardHistoryStatus>("clipboard_history", { query: "" });
  return { enabled, access };
}

export async function setClipboardHistoryEnabled(enabled: boolean): Promise<boolean> {
  return invoke<boolean>("clipboard_set_enabled", { enabled });
}

/** Calls back when a copy is kept, or what macOS lets Compose read changes. */
export function onClipboardHistoryChanged(callback: () => void): Promise<() => void> {
  return listen("clipboard:changed", () => callback());
}

/** Forget every copy but the pinned ones. */
export async function clearClipboardHistory(): Promise<void> {
  await invoke("clipboard_clear");
}

/** Open the macOS setting that lets Compose read what other apps copy. */
export async function openClipboardPrivacySettings(): Promise<void> {
  await invoke("clipboard_privacy_settings");
}
