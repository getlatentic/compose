import type { ExportFont } from "./exportFont";
import { PALETTES, type PaletteFonts } from "./palettes";
import { effectiveReadingFont, type ReadingFont } from "./reading";

/**
 * The fonts an export sets a note in, in the shape the Rust exporter reads
 * (`export::typeface`): the note's reading font, resolved the way the editor
 * resolves it, so a note written in New York prints in New York.
 */

export type Typeface =
  | { readonly kind: "bundled"; readonly face: "latinModern" | "plexSerif" | "plexSans" | "jetbrainsMono" }
  | { readonly kind: "system"; readonly font: "sans" | "serif" | "mono" }
  | { readonly kind: "installed"; readonly family: string };

export interface ExportTypefaces {
  readonly body: Typeface;
  readonly heading: Typeface;
  readonly code: Typeface;
}

const PLEX_SERIF: Typeface = { kind: "bundled", face: "plexSerif" };
const PLEX_SANS: Typeface = { kind: "bundled", face: "plexSans" };
const JETBRAINS: Typeface = { kind: "bundled", face: "jetbrainsMono" };
const SYSTEM_SANS: Typeface = { kind: "system", font: "sans" };
const SYSTEM_SERIF: Typeface = { kind: "system", font: "serif" };
const SYSTEM_MONO: Typeface = { kind: "system", font: "mono" };
const CHALKBOARD: Typeface = { kind: "installed", family: "Chalkboard SE" };

/** A palette's font names (`palettes.json`) as typefaces. */
const BY_PALETTE_NAME: Readonly<Record<string, Typeface>> = {
  "IBM Plex Serif": PLEX_SERIF,
  "IBM Plex Sans": PLEX_SANS,
  "JetBrains Mono": JETBRAINS,
  "Chalkboard SE": CHALKBOARD,
  System: SYSTEM_SANS,
  "System Mono": SYSTEM_MONO,
};

function fromPalette(fonts: PaletteFonts): ExportTypefaces {
  const face = (name: string, fallback: Typeface) => BY_PALETTE_NAME[name] ?? fallback;
  return { body: face(fonts.docBody, PLEX_SERIF), heading: face(fonts.docHeading, PLEX_SANS), code: face(fonts.docCode, JETBRAINS) };
}

export interface TypefaceChoices {
  readonly palette: string;
  readonly readingFont: ReadingFont;
  readonly customFont: string | null;
  readonly exportFont: ExportFont;
}

/** `undefined` asks the exporter for its default: Latin Modern, the LaTeX look. */
export function exportTypefacesFor(choices: TypefaceChoices): ExportTypefaces | undefined {
  if (choices.exportFont === "latex") return undefined;
  switch (effectiveReadingFont(choices.readingFont, choices.customFont)) {
    case "serif":
      return { body: PLEX_SERIF, heading: PLEX_SANS, code: JETBRAINS };
    case "sans":
      return { body: PLEX_SANS, heading: PLEX_SANS, code: JETBRAINS };
    case "mono":
      return { body: JETBRAINS, heading: JETBRAINS, code: JETBRAINS };
    case "newYork":
      return { body: SYSTEM_SERIF, heading: SYSTEM_SANS, code: SYSTEM_MONO };
    case "sfPro":
      return { body: SYSTEM_SANS, heading: SYSTEM_SANS, code: SYSTEM_MONO };
    case "chalkboard":
      return { body: CHALKBOARD, heading: CHALKBOARD, code: JETBRAINS };
    case "custom": {
      const family: Typeface = { kind: "installed", family: choices.customFont ?? "" };
      return { body: family, heading: family, code: JETBRAINS };
    }
    case "theme": {
      const palette = PALETTES.find((candidate) => candidate.id === choices.palette) ?? PALETTES[0];
      return fromPalette(palette.fonts);
    }
  }
}
