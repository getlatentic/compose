import { reportClientError } from "../diagnostics/errorReporter";
import { isTauriRuntime } from "../runtime/desktopRuntime";
import type { ThemeChoice } from "./theme";

/**
 * Two facts about the native window that the stylesheet needs, and the one
 * the window needs from the app (its light or dark):
 *
 * - `data-vibrancy`: the window is transparent over the system's sidebar
 *   material (Compose on a Mac; see `windowEffects` in tauri.conf.json). The
 *   page then paints only its panels. index.html sets it before first paint;
 *   this module is the same test for code that runs later.
 * - `data-window="active" | "inactive"`: whether the window is in front. macOS
 *   greys a window's selection and dims its controls when another window is
 *   key, and the stylesheet does the same.
 */

interface ChromeWindow {
  readonly navigator: Pick<Navigator, "platform">;
  readonly __TAURI_INTERNALS__?: unknown;
}

export function hasVibrancy(win: ChromeWindow): boolean {
  return Boolean(win.__TAURI_INTERNALS__) && /Mac/.test(win.navigator.platform);
}

/** Keeps `data-window` in step with focus; returns the function that stops it. */
export function trackWindowFocus(root: HTMLElement, win: Window = window): () => void {
  const set = (active: boolean) => root.setAttribute("data-window", active ? "active" : "inactive");
  const onFocus = () => set(true);
  const onBlur = () => set(false);
  set(win.document.hasFocus());
  win.addEventListener("focus", onFocus);
  win.addEventListener("blur", onBlur);
  return () => {
    win.removeEventListener("focus", onFocus);
    win.removeEventListener("blur", onBlur);
  };
}

/**
 * The native window takes the app's light or dark, or follows the Mac for
 * "system". The sidebar's glass, the title bar and the traffic lights are
 * drawn by macOS from the window's appearance, not from the page, so without
 * this a Light app on a Dark Mac puts dark labels on dark glass.
 */
export async function syncWindowAppearance(theme: ThemeChoice): Promise<void> {
  if (!isTauriRuntime()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTheme(theme === "system" ? null : theme);
  } catch (error) {
    await reportClientError("window-appearance", "Could not set the window's light or dark", String(error));
  }
}
