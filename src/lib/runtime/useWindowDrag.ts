import { useCallback, type MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { isTauriRuntime } from "./desktopRuntime";

/**
 * Tauri 2 drag-region recipe — the `data-tauri-drag-region` attribute alone
 * is unreliable in our setup (WKWebView + `titleBarStyle: "Overlay"`), so we
 * fall back to the JS API recommended in Tauri's window-customization docs.
 *
 * The window handle is imported eagerly: `startDragging()` must be called
 * synchronously inside the `mousedown` listener, while the user is still
 * holding the button down — a dynamic import would resolve too late and the
 * OS would miss the drag.
 *
 * Returns a `mousedown` handler that:
 *   * Ignores clicks on interactive elements (buttons, links, inputs,
 *     anything marked `data-no-drag`).
 *   * Double-click maximizes the window — matches the macOS title-bar
 *     convention.
 *   * Single-click drag starts a real window drag via `startDragging()`.
 *
 * Attach to a row whose visible area should drag the window — usually the
 * 40px-high title-bar zone at the top of a pane.
 */
export function useWindowDrag() {
  return useCallback(function onWindowDragMouseDown(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if (!isTauriRuntime()) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.closest("[data-no-drag]")) return;
    if (target.closest("button, a, input, textarea, select, [role='button']")) return;

    const win = getCurrentWindow();
    if (event.detail === 2) {
      void win.toggleMaximize();
    } else {
      void win.startDragging();
    }
  }, []);
}
