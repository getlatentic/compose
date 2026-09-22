import { invoke } from "@tauri-apps/api/core";

/** `needsApproval`: registered, but switched off under Login Items in System Settings. */
export type LoginItemStatus = "off" | "on" | "needsApproval";

/** Whether Compose opens at login; `null` where it cannot, before macOS 13. */
export async function loginItemStatus(): Promise<LoginItemStatus | null> {
  return invoke<LoginItemStatus | null>("login_item_status");
}

/** Turn opening at login on or off; says what macOS made of it. */
export async function setLoginItem(enabled: boolean): Promise<LoginItemStatus | null> {
  return invoke<LoginItemStatus | null>("login_item_set", { enabled });
}

/** Open System Settings → General → Login Items. */
export async function openLoginItemSettings(): Promise<void> {
  await invoke("login_item_settings");
}
