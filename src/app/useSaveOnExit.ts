import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauriRuntime } from "../lib/runtime/desktopRuntime";
import { useWorkspaceStore } from "./workspaceStore";

/**
 * Persist every dirty buffer before the app closes (#43).
 *
 * On desktop we intercept the window's close request, write all unsaved edits
 * (active and background tabs), then destroy the window — so quitting never
 * drops work, even keystrokes still inside the 500ms editor debounce. A save
 * failure still lets the window close (the `finally`) so the user is never
 * trapped. The browser preview can't await an async save during `unload`, so it
 * falls back to the native unsaved-changes warning.
 */
export function useSaveOnExit() {
  useEffect(() => {
    if (isTauriRuntime()) {
      let unlisten: (() => void) | undefined;
      let closing = false;
      const win = getCurrentWindow();
      void win
        .onCloseRequested(async (event) => {
          if (closing) {
            return;
          }
          event.preventDefault();
          closing = true;
          try {
            await useWorkspaceStore.getState().saveAllDirtyBuffers();
          } finally {
            try {
              // Requires `core:window:allow-destroy` in the capability — without
              // it this rejects and the red button silently does nothing.
              await win.destroy();
            } catch {
              // Destroy failed (e.g. a missing permission): re-arm so the next
              // close click retries the whole path instead of stranding the
              // window behind the spent guard.
              closing = false;
            }
          }
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {});
      return () => unlisten?.();
    }

    function onBeforeUnload(event: BeforeUnloadEvent) {
      const hasDirty = useWorkspaceStore
        .getState()
        .workspaces.some((workspace) =>
          Object.values(workspace.fileContents).some((buffer) => buffer.dirty),
        );
      if (hasDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
}
