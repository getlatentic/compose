/**
 * Which font exports (PDF, HTML, print, image) set the note in: the note's
 * own reading font, or Latin Modern, the LaTeX look.
 */
export const EXPORT_FONTS = ["note", "latex"] as const;
export type ExportFont = (typeof EXPORT_FONTS)[number];
export const DEFAULT_EXPORT_FONT: ExportFont = "note";

export function normalizeExportFont(value: unknown): ExportFont {
  return EXPORT_FONTS.includes(value as ExportFont) ? (value as ExportFont) : DEFAULT_EXPORT_FONT;
}
