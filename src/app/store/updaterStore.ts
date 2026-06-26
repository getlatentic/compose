import { create } from "zustand";

import { checkForUpdate, relaunchApp, type PendingUpdate } from "../../lib/ipc/updater";
import { showToast } from "../../features/toast/toastStore";

/** The self-update lifecycle. `available` carries the found update so the banner
 *  can start the download; `downloading` carries live byte progress; `ready`
 *  means it's installed and a relaunch is in flight. */
export type UpdaterStatus =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; update: PendingUpdate }
  | { phase: "downloading"; update: PendingUpdate; downloaded: number; total: number | null }
  | { phase: "ready" }
  | { phase: "error"; message: string };

interface UpdaterState {
  status: UpdaterStatus;
  /** The user dismissed the banner for the current available update. */
  dismissed: boolean;
  /** Check for a newer release. `manual` (the Settings button) surfaces the
   *  "up to date" / failure result as a toast; the silent launch check doesn't. */
  check: (options?: { manual?: boolean }) => Promise<void>;
  /** Download + install the available update, then relaunch into it. */
  downloadAndRestart: () => Promise<void>;
  /** Hide the banner until the next time an update is found. */
  dismiss: () => void;
}

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: { phase: "idle" },
  dismissed: false,

  check: async ({ manual = false } = {}) => {
    const { phase } = get().status;
    // Never interrupt an in-flight check or download.
    if (phase === "checking" || phase === "downloading") {
      return;
    }
    set({ status: { phase: "checking" } });
    try {
      const update = await checkForUpdate();
      if (update) {
        set({ status: { phase: "available", update }, dismissed: false });
      } else {
        set({ status: { phase: "idle" } });
        if (manual) {
          showToast({ kind: "success", title: "Up to date", message: "You're on the latest version." });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn't check for updates.";
      set({ status: { phase: "error", message } });
      // The launch check fails silently (no endpoint yet, offline, …); only a
      // user-initiated check reports the problem.
      if (manual) {
        showToast({ kind: "error", title: "Update check failed", message });
      }
    }
  },

  downloadAndRestart: async () => {
    const current = get().status;
    const update = current.phase === "available" ? current.update : null;
    if (!update) {
      return;
    }
    set({ status: { phase: "downloading", update, downloaded: 0, total: null } });
    try {
      await update.install((progress) =>
        set({
          status: {
            phase: "downloading",
            update,
            downloaded: progress.downloaded,
            total: progress.total,
          },
        }),
      );
      set({ status: { phase: "ready" } });
      await relaunchApp();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Couldn't install the update.";
      set({ status: { phase: "error", message } });
      showToast({ kind: "error", title: "Update failed", message });
    }
  },

  dismiss: () => set({ dismissed: true }),
}));
