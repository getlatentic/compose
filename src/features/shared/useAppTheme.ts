import { useEffect } from "react";

import { useUiStore } from "../../app/store/uiStore";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

import { applyAppearance } from "../../lib/theme/appearance";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { applyNoteBackground } from "../../lib/theme/noteBackground";
import { syncWindowAppearance } from "../../lib/theme/windowChrome";

/**
 * Keeps the appearance choices (light/dark, palette, reading font and size) on
 * the document.
 *
 * `main.tsx` applies the stored choices before the first paint, which is what
 * stops a launch flashing the wrong theme. This is the other half: without it
 * the store and the preferences update, the control moves, and the app keeps
 * what it booted with until the next launch.
 *
 * Following the system needs no listener: the `prefers-color-scheme` rules do
 * that in CSS, which is why "system" removes `data-theme` instead of resolving it.
 * The native window is told too, since macOS draws the glass from it.
 */
export function useAppTheme(): void {
  const theme = useUiStore((state) => state.theme);
  const palette = useUiStore((state) => state.palette);
  const readingFont = useUiStore((state) => state.readingFont);
  const readingSize = useUiStore((state) => state.readingSize);
  const customFont = useUiStore((state) => state.customFont);
  const editorScheme = useUiStore((state) => state.editorScheme);

  useEffect(() => {
    applyAppearance({ theme, palette, readingFont, readingSize, customFont, editorScheme }, document.documentElement);
  }, [theme, palette, readingFont, readingSize, customFont, editorScheme]);

  useEffect(() => {
    void syncWindowAppearance(theme);
  }, [theme]);

  const noteBackground = useUiStore((state) => state.noteBackground);
  useEffect(() => {
    const root = document.documentElement;
    if (noteBackground.kind !== "image" || !isTauriRuntime()) {
      applyNoteBackground(noteBackground, root, (file) => file);
      return;
    }
    // After a launch the kept image's folder has to be allowed again before
    // the web view may load it.
    let live = true;
    void invoke("background_image_allow")
      .catch(() => undefined)
      .then(() => {
        if (live) applyNoteBackground(noteBackground, root, convertFileSrc);
      });
    return () => {
      live = false;
    };
  }, [noteBackground]);
}
