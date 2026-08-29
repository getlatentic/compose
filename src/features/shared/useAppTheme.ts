import { useEffect } from "react";

import { useUiStore } from "../../app/store/uiStore";
import { applyTheme } from "../../lib/theme/theme";

/**
 * Keeps the theme choice on the document.
 *
 * `main.tsx` applies the stored choice before the first paint, which is what
 * stops a launch flashing the wrong theme. This is the other half: without it
 * the store and the preferences file update, the radio moves, and the app keeps
 * the theme it booted with until the next launch.
 *
 * Following the system needs no listener — the `prefers-color-scheme` block in
 * `_tokens.scss` does that in CSS, which is why "system" removes the attribute
 * instead of resolving it here.
 */
export function useAppTheme(): void {
  const theme = useUiStore((state) => state.theme);

  useEffect(() => {
    applyTheme(theme, document.documentElement);
  }, [theme]);
}
