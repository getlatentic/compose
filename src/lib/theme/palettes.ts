/**
 * The colour themes ("palettes"): Classic, Walnut, Graphite, Sepia, Forest,
 * Carbon and Paper. Each sets a colour and a font for every part of the
 * window — the app's own UI, note text, note headings and code — in light and
 * dark.
 *
 * `palettes.json` holds the values: Classic is Compose's original Carbon
 * gray-and-blue look in the system font, the rest are exactly as the Figma
 * Theme collection has them. `paletteCss.ts` turns them into custom properties; this module is
 * the typed list and the one attribute that picks a palette.
 *
 * Light and dark are a separate choice (`theme.ts`): a palette names both
 * halves and the appearance picks one.
 */

import data from "./palettes.json";

export interface PaletteFonts {
  readonly ui: string;
  readonly docBody: string;
  readonly docHeading: string;
  readonly docHeadingWeight: number;
  readonly docCode: string;
}

/** Token name (`"bg/app"`, `"sidebar/text"`, …) to a `#RRGGBB` colour. */
export type PaletteColors = Readonly<Record<string, string>>;

export interface Palette {
  readonly id: string;
  readonly label: string;
  /** Hover, pressed and hairline colours are the palette's own flat greys, not tints of the text. */
  readonly solidStates?: boolean;
  readonly fonts: PaletteFonts;
  readonly light: PaletteColors;
  readonly dark: PaletteColors;
}

export const PALETTES: readonly Palette[] = data.palettes;

export const DEFAULT_PALETTE: string = data.defaultPalette;

/** A stored choice is untrusted: an older build, a hand-edited file, a removed palette. */
export function normalizePalette(value: unknown): string {
  return PALETTES.some((palette) => palette.id === value) ? (value as string) : DEFAULT_PALETTE;
}

export function applyPalette(id: string, root: HTMLElement): void {
  root.setAttribute("data-palette", normalizePalette(id));
}
