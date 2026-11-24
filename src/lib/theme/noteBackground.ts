/**
 * What sits behind the note: the theme's own page colour, a colour of the
 * writer's, or an image (kept in Compose's data folder; see
 * `src-tauri/src/backgrounds.rs`). Applied as root attributes and properties
 * that `_note-background.scss` reads, inside the note panel only.
 */

export type NoteBackground =
  | { readonly kind: "theme" }
  | { readonly kind: "color"; readonly color: string }
  | { readonly kind: "image"; readonly file: string; readonly fit: ImageFit; readonly dim: number };

export type ImageFit = "fill" | "tile";

export const THEME_BACKGROUND: NoteBackground = { kind: "theme" };
/** Enough page colour over a photo that body text stays readable on it. */
export const DEFAULT_DIM = 0.7;
const MAX_DIM = 0.95;

const HEX = /^#[0-9a-f]{6}$/i;

export function normalizeNoteBackground(value: unknown): NoteBackground {
  if (typeof value !== "object" || value === null) return THEME_BACKGROUND;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "color" && typeof candidate.color === "string" && HEX.test(candidate.color)) {
    return { kind: "color", color: candidate.color.toLowerCase() };
  }
  if (candidate.kind === "image" && typeof candidate.file === "string" && candidate.file.length > 0) {
    const dim = typeof candidate.dim === "number" && Number.isFinite(candidate.dim) ? candidate.dim : DEFAULT_DIM;
    return {
      kind: "image",
      file: candidate.file,
      fit: candidate.fit === "tile" ? "tile" : "fill",
      dim: Math.min(MAX_DIM, Math.max(0, dim)),
    };
  }
  return THEME_BACKGROUND;
}

/** Relative luminance (WCAG) of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const channel = (index: number) => {
    const value = parseInt(hex.slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * The ink a page colour needs: dark text on a light colour, light text on a
 * dark one, whatever the theme. The threshold is where black and white text
 * reach the same contrast.
 */
export function inkFor(hex: string): "dark" | "light" {
  return luminance(hex) > 0.179 ? "dark" : "light";
}

/**
 * Sets the background on the root. `imageUrl` turns the stored file into a
 * URL the web view can load (the asset protocol in Compose).
 */
export function applyNoteBackground(background: NoteBackground, root: HTMLElement, imageUrl: (file: string) => string): void {
  const style = root.style;
  root.setAttribute("data-note-bg", background.kind);
  root.removeAttribute("data-note-ink");
  for (const property of ["--note-bg-color", "--note-bg-image", "--note-bg-dim", "--note-bg-size", "--note-bg-repeat"]) {
    style.removeProperty(property);
  }
  if (background.kind === "color") {
    style.setProperty("--note-bg-color", background.color);
    root.setAttribute("data-note-ink", inkFor(background.color));
  } else if (background.kind === "image") {
    style.setProperty("--note-bg-image", `url("${imageUrl(background.file).replace(/"/g, "%22")}")`);
    style.setProperty("--note-bg-dim", `${Math.round(background.dim * 100)}%`);
    style.setProperty("--note-bg-size", background.fit === "tile" ? "auto" : "cover");
    style.setProperty("--note-bg-repeat", background.fit === "tile" ? "repeat" : "no-repeat");
  }
}
