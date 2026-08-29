import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

import { useUiStore } from "../../app/store/uiStore";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { DEFAULT_ZOOM, applyZoom, zoomIn, zoomOut } from "../../lib/zoom/zoom";

/**
 * Keeps the interface scale on the document and listens for the three ways it
 * can change.
 *
 * The native View menu carries the accelerators, so ⌘= / ⌘− / ⌘0 work wherever
 * focus sits — including inside the editor, which otherwise swallows key
 * handling. The key listener here covers only what a menu accelerator cannot:
 * ⌘⇧= , which is what a keyboard actually sends when someone presses the "⌘+"
 * the menu advertises.
 */
export function useAppZoom(): void {
  const zoom = useUiStore((state) => state.zoom);

  useEffect(() => {
    applyZoom(zoom, document.documentElement);
  }, [zoom]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    const unlistens = [
      listen("menu://zoom-in", () => {
        const { zoom: current, setZoom } = useUiStore.getState();
        setZoom(zoomIn(current));
      }),
      listen("menu://zoom-out", () => {
        const { zoom: current, setZoom } = useUiStore.getState();
        setZoom(zoomOut(current));
      }),
      listen("menu://zoom-reset", () => {
        useUiStore.getState().setZoom(DEFAULT_ZOOM);
      }),
    ];
    return () => {
      void Promise.all(unlistens).then((fns) => {
        for (const off of fns) {
          off();
        }
      });
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // Only the shifted chord: the menu already owns the unshifted keys, and
      // handling those here too would step twice on one press.
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) {
        return;
      }
      // `+` on a US layout, `=` where shift does not relabel the key.
      if (event.key !== "+" && event.key !== "=") {
        return;
      }
      event.preventDefault();
      const { zoom: current, setZoom } = useUiStore.getState();
      setZoom(zoomIn(current));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
