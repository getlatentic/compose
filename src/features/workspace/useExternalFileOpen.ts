import { useEffect } from "react";

import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { resolveOpenPath } from "../../lib/ipc/externalFilesClient";
import { showErrorToast } from "../toast/toastStore";
import { useWorkspaceStore } from "../../app/workspaceStore";

const EXTERNAL_FILE_OPEN_EVENT = "compose:open-external-file";
const DRAIN_PENDING_URLS_CMD = "drain_pending_open_urls";

/**
 * Route OS-opened files (Finder Open-With, `open -a Compose file.md`) — #113.
 *
 * A file inside a registered workspace opens IN PLACE: switch to that
 * workspace and select it — never mount a new workspace. Anything else joins
 * the External-files list and opens as a loose tab at its real absolute path
 * — nothing mounted, nothing copied.
 *
 * Mounted by MainApp, which exists only after boot hydration — so the
 * cold-start drain always sees the hydrated workspace list. URLs that arrive
 * earlier (launch-by-double-click, or during onboarding) sit buffered on the
 * Rust side until this drains them.
 */
export function useExternalFileOpen(): void {
  useEffect(function bindExternalFileOpen() {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;

    async function openFromOs(absolutePath: string) {
      if (!absolutePath) return;
      try {
        const target = await resolveOpenPath(absolutePath);
        if (disposed) return;
        const store = useWorkspaceStore.getState();
        if (target.kind === "workspace") {
          if (store.activeWorkspaceId !== target.workspaceId) {
            store.switchWorkspace(target.workspaceId);
          }
          await useWorkspaceStore.getState().selectFile(target.relativePath);
        } else {
          await store.openLooseFile(target.path);
        }
      } catch (error) {
        showErrorToast(error instanceof Error ? error.message : "Could not open file");
      }
    }

    void (async () => {
      const tauri = await import("@tauri-apps/api/core");
      const eventApi = await import("@tauri-apps/api/event");
      if (disposed) return;
      // Cold-start path: any URLs that arrived before this listener mounted
      // were buffered on the Rust side. Drain them and route the same way.
      try {
        const pending = await tauri.invoke<string[]>(DRAIN_PENDING_URLS_CMD);
        if (!disposed) {
          for (const path of pending) {
            await openFromOs(path);
          }
        }
      } catch (error) {
        console.error("Failed to drain pending open URLs:", error);
      }
      if (disposed) return;
      // Warm-start path: live listener for URLs that arrive while the app
      // is already running.
      unlisten = await eventApi.listen<string>(EXTERNAL_FILE_OPEN_EVENT, (event) => {
        void openFromOs(event.payload);
      });
    })();

    return function unbind() {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);
}
