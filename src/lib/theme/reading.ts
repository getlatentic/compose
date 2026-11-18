/**
 * How notes read: the reading font and the text size. Both are attributes on
 * the root; `_reading.scss` turns them into the `--reading-*` properties the
 * editor's document theme reads.
 *
 * "theme" is a real choice, not an absence: it hands the note fonts back to
 * the palette, so Paper's notes are in Chalkboard and Carbon's in Plex Sans.
 */

export const READING_FONTS = ["theme", "serif", "sans", "mono", "chalkboard"] as const;
export type ReadingFont = (typeof READING_FONTS)[number];
export const DEFAULT_READING_FONT: ReadingFont = "theme";

export const READING_SIZES = ["small", "default", "large"] as const;
export type ReadingSize = (typeof READING_SIZES)[number];
export const DEFAULT_READING_SIZE: ReadingSize = "default";

export function normalizeReadingFont(value: unknown): ReadingFont {
  return READING_FONTS.includes(value as ReadingFont) ? (value as ReadingFont) : DEFAULT_READING_FONT;
}

export function normalizeReadingSize(value: unknown): ReadingSize {
  return READING_SIZES.includes(value as ReadingSize) ? (value as ReadingSize) : DEFAULT_READING_SIZE;
}

export function applyReadingStyle(font: ReadingFont, size: ReadingSize, root: HTMLElement): void {
  root.setAttribute("data-reading-font", normalizeReadingFont(font));
  root.setAttribute("data-reading-size", normalizeReadingSize(size));
}
