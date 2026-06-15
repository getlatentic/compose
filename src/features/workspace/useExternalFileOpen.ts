import { useEffect } from "react";

import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { addWorkspace } from "../../lib/ipc/workspaceClient";
import { useWorkspaceStore } from "../../app/workspaceStore";

const EXTERNAL_FILE_OPEN_EVENT = "compose:open-external-file";
const DRAIN_PENDING_URLS_CMD = "drain_pending_open_urls";
const SELECT_AFTER_SCAN_DELAY_MS = 250;

function parentDirectory(absolutePath: string): string {
  const idx = absolutePath.lastIndexOf("/");
  return idx <= 0 ? absolutePath : absolutePath.slice(0, idx);
}

function basename(absolutePath: string): string {
  const idx = absolutePath.lastIndexOf("/");
  return idx === -1 ? absolutePath : absolutePath.slice(idx + 1);
}

export function useExternalFileOpen(): void {
  const hydrateWorkspaces = useWorkspaceStore((state) => state.hydrateWorkspaces);
  const switchWorkspace = useWorkspaceStore((state) => state.switchWorkspace);
  const selectFile = useWorkspaceStore((state) => state.selectFile);

  useEffect(function bindExternalFileOpen() {
    if (!isTauriRuntime()) return;
    let unlisten: (() => void) | null = null;
    let pendingSelect: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    async function openExternalFile(absolutePath: string) {
      if (!absolutePath) return;
      const parent = parentDirectory(absolutePath);
      const fileName = basename(absolutePath);
      try {
        const list = await addWorkspace(parent);
        if (disposed) return;
        hydrateWorkspaces(list);
        const target =
          list.workspaces.find((w) => w.id === list.activeWorkspaceId) ??
          list.workspaces[list.workspaces.length - 1];
        if (!target) return;
        switchWorkspace(target.id);
        if (pendingSelect) clearTimeout(pendingSelect);
        pendingSelect = setTimeout(() => {
          void selectFile(fileName);
        }, SELECT_AFTER_SCAN_DELAY_MS);
      } catch (error) {
        console.error("Failed to open external file:", error);
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
            await openExternalFile(path);
          }
        }
      } catch (error) {
        console.error("Failed to drain pending open URLs:", error);
      }
      if (disposed) return;
      // Warm-start path: live listener for URLs that arrive while the app
      // is already running.
      unlisten = await eventApi.listen<string>(EXTERNAL_FILE_OPEN_EVENT, (event) => {
        void openExternalFile(event.payload);
      });
    })();

    return function unbind() {
      disposed = true;
      if (pendingSelect) clearTimeout(pendingSelect);
      if (unlisten) unlisten();
    };
  }, [hydrateWorkspaces, switchWorkspace, selectFile]);
}
