/**
 * Two facts about the native window that the stylesheet needs:
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
