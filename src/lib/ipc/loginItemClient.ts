import { invoke } from "@tauri-apps/api/core";

/** `needsApproval`: registered, but switched off under Login Items in System Settings. */
export type LoginItemStatus = "off" | "on" | "needsApproval";

/** Compose itself, or the helper that keeps the quick-note shortcuts while Compose is quit. */
export type LoginItemService = "app" | "shortcutsHelper";

/** Whether `service` runs at login; `null` where it cannot — before macOS 13, or a build without the helper. */
export async function loginItemStatus(service: LoginItemService): Promise<LoginItemStatus | null> {
  return invoke<LoginItemStatus | null>("login_item_status", { service });
}

/** Run `service` at login, or stop; says what macOS made of it. */
export async function setLoginItem(service: LoginItemService, enabled: boolean): Promise<LoginItemStatus | null> {
  return invoke<LoginItemStatus | null>("login_item_set", { service, enabled });
}

/** Open System Settings → General → Login Items. */
export async function openLoginItemSettings(): Promise<void> {
  await invoke("login_item_settings");
}
