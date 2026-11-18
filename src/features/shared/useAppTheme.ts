import { useEffect } from "react";

import { useUiStore } from "../../app/store/uiStore";
import { applyAppearance } from "../../lib/theme/appearance";

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
 */
export function useAppTheme(): void {
  const theme = useUiStore((state) => state.theme);
  const palette = useUiStore((state) => state.palette);
  const readingFont = useUiStore((state) => state.readingFont);
  const readingSize = useUiStore((state) => state.readingSize);

  useEffect(() => {
    applyAppearance({ theme, palette, readingFont, readingSize }, document.documentElement);
  }, [theme, palette, readingFont, readingSize]);
}
