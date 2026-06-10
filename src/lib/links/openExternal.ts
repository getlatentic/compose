import { isTauriRuntime } from "../runtime/desktopRuntime";

/**
 * Open an external URL in the user's default browser. On the desktop this goes
 * through the opener plugin (so the link leaves the app's webview rather than
 * navigating it); in the browser preview it's a normal new-tab open.
 *
 * Only ever called for a link the user explicitly clicked.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
