import { isTauriRuntime } from "../runtime/desktopRuntime";

export interface DownloadProgress {
  /** Bytes downloaded so far. */
  downloaded: number;
  /** Total bytes, or null if the server didn't report a content length. */
  total: number | null;
}

/** A newer signed release the updater found, ready to download + install. Wraps
 *  the plugin's `Update` so the store/UI never touch the Tauri API directly. */
export interface PendingUpdate {
  version: string;
  notes: string | null;
  /** Download + install the update, reporting byte progress. Resolves once the
   *  new bundle is in place; the caller then relaunches. */
  install(onProgress: (progress: DownloadProgress) => void): Promise<void>;
}

/**
 * Check the configured endpoint for a newer signed release. Returns `null` when
 * already up to date, when the updater isn't armed (no pubkey/manifest yet), or
 * outside the desktop app (browser preview). Throws only on an unexpected
 * failure the caller wants to surface (a manual check).
 */
export async function checkForUpdate(): Promise<PendingUpdate | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) {
    return null;
  }
  return {
    version: update.version,
    notes: update.body ?? null,
    async install(onProgress) {
      let downloaded = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          onProgress({ downloaded, total });
        } else if (event.event === "Finished") {
          onProgress({ downloaded, total });
        }
      });
    },
  };
}

/** Relaunch into the freshly-installed version. No-op outside the desktop app. */
export async function relaunchApp(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
