/**
 * Light, dark, or whatever the system is doing.
 *
 * "System" is a real third state, not light-with-a-listener. Someone who picks
 * Light keeps Light when their Mac turns dark at sunset; someone on System
 * follows it. The distinction only survives if the stored value can say
 * "system" — a boolean cannot express it.
 *
 * The CSS side is in `styles/_tokens.scss`: `:root` is light, a
 * `prefers-color-scheme` block guarded by `:not([data-theme="light"])` follows
 * the system, and `[data-theme]` overrides both. So this module's whole job is
 * to set or clear one attribute.
 */

export const THEME_CHOICES = ["system", "light", "dark"] as const;

export type ThemeChoice = (typeof THEME_CHOICES)[number];

/** Following the system is the right default: it is already the user's answer. */
export const DEFAULT_THEME: ThemeChoice = "system";

/** A stored choice is untrusted — an older build, a hand-edited file, `null`. */
export function normalizeTheme(value: unknown): ThemeChoice {
  return THEME_CHOICES.includes(value as ThemeChoice) ? (value as ThemeChoice) : DEFAULT_THEME;
}

/**
 * What the user will actually see, which is the choice unless it defers.
 * Callers that need to *draw* something themed (a canvas, an exported image)
 * need this rather than the raw choice.
 */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): "light" | "dark" {
  if (choice === "system") {
    return prefersDark ? "dark" : "light";
  }
  return choice;
}

/**
 * Absent on "system" rather than set to the resolved value: the attribute is
 * what overrides the media query, so writing it would freeze the theme at
 * whatever the system happened to be when the app started.
 */
export function applyTheme(choice: ThemeChoice, root: HTMLElement): void {
  const normalized = normalizeTheme(choice);
  if (normalized === "system") {
    root.removeAttribute("data-theme");
    return;
  }
  root.setAttribute("data-theme", normalized);
}

/** True when the OS is currently asking for dark. False where unsupported. */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
