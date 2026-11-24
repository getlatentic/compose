import { useEffect } from "react";

import { useUiStore } from "../../app/store/uiStore";
import { convertFileSrc } from "@tauri-apps/api/core";

import { applyAppearance } from "../../lib/theme/appearance";
import { reportClientError } from "../../lib/diagnostics/errorReporter";
import { allowBackgroundImage } from "../../lib/ipc/backgroundClient";
import { isTauriRuntime } from "../../lib/runtime/desktopRuntime";
import { applyNoteBackground } from "../../lib/theme/noteBackground";
import { syncWindowAppearance } from "../../lib/theme/windowChrome";

/**
 * Keeps the appearance choices (light/dark, palette, reading font and size) on
 * the document.
 *
 * `main.tsx` applies the stored choices before the first paint; this keeps
 * them applied as they change.
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
    allowBackgroundImage()
      .catch((error: unknown) => reportClientError("note-background", "Could not show the note's background image", String(error)))
      .finally(() => {
        if (live) applyNoteBackground(noteBackground, root, convertFileSrc);
      });
    return () => {
      live = false;
    };
  }, [noteBackground]);
}
