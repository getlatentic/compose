/**
 * How notes read: the reading font and the text size. The font is an
 * attribute on the root and the size a `--reading-base` property;
 * `_reading.scss` turns them into the `--reading-*` properties the editor's
 * document theme reads.
 *
 * "theme" is a real choice, not an absence: it hands the note fonts back to
 * the palette, so Paper's notes are in Chalkboard and Carbon's in Plex Sans.
 * "custom" is any font installed on the Mac; its family name travels in the
 * `--font-custom` property.
 */

export const READING_FONTS = ["theme", "serif", "sans", "mono", "newYork", "sfPro", "chalkboard", "custom"] as const;
export type ReadingFont = (typeof READING_FONTS)[number];
export const DEFAULT_READING_FONT: ReadingFont = "theme";

/** The body text size in CSS pixels; headings and line heights scale from it. */
export type ReadingSize = number;
export const MIN_READING_SIZE = 12;
export const MAX_READING_SIZE = 32;
export const DEFAULT_READING_SIZE: ReadingSize = 18;

/** Sizes stored before the size was a number. */
const NAMED_SIZES: Readonly<Record<string, ReadingSize>> = { small: 16, default: 18, large: 20 };

/** Font family names are short; anything longer is not one. */
const MAX_FAMILY_LENGTH = 120;

export function normalizeReadingFont(value: unknown): ReadingFont {
  return READING_FONTS.includes(value as ReadingFont) ? (value as ReadingFont) : DEFAULT_READING_FONT;
}

export function normalizeReadingSize(value: unknown): ReadingSize {
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(NAMED_SIZES, value)) return NAMED_SIZES[value];
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_READING_SIZE;
  return Math.min(MAX_READING_SIZE, Math.max(MIN_READING_SIZE, Math.round(value)));
}

/** A stored installed-font name: a trimmed, bounded string, or none. */
export function normalizeCustomFont(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 && name.length <= MAX_FAMILY_LENGTH ? name : null;
}

/** A family name as a CSS string, safe for any characters a font name holds. */
export function cssFamily(name: string): string {
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * "custom" without a font to use reads as the theme's font, so a missing or
 * cleared choice never leaves the note in a fallback face.
 */
export function effectiveReadingFont(font: ReadingFont, customFont: string | null): ReadingFont {
  return font === "custom" && !customFont ? DEFAULT_READING_FONT : font;
}

export function applyReadingStyle(font: ReadingFont, size: ReadingSize, customFont: string | null, root: HTMLElement): void {
  const custom = normalizeCustomFont(customFont);
  root.setAttribute("data-reading-font", effectiveReadingFont(normalizeReadingFont(font), custom));
  root.style.setProperty("--reading-base", `${normalizeReadingSize(size) / 16}rem`);
  if (custom) root.style.setProperty("--font-custom", cssFamily(custom));
  else root.style.removeProperty("--font-custom");
}
