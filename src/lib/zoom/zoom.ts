/**
 * App zoom — one scale factor for the whole interface.
 *
 * The app sizes in `rem` almost everywhere (chrome and document text alike, the
 * editor package included), so scaling the root font size scales all of it from
 * a single property. Hairlines, radii and shadows stay in `px` on purpose: a 1px
 * border is a 1px border at any zoom, and growing it just looks broken.
 */

/**
 * Discrete stops rather than free-floating multiplication, so repeated presses
 * land somewhere predictable and round-tripping through a preference file can't
 * drift. The same shape browsers use.
 */
export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

export const DEFAULT_ZOOM = 1;

const MIN = ZOOM_STEPS[0];
const MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/**
 * Floating-point steps compare badly: a stored 1.25 can arrive as
 * 1.2500000000000002, and "the first step greater than this" would then skip
 * 1.25 and jump straight to 1.5.
 */
const EPSILON = 1e-9;

/**
 * A persisted scale is untrusted: hand-edited files, a value from a build whose
 * step list differed, `null` from a first run. Anything unusable becomes the
 * default rather than shrinking the app to nothing.
 */
export function clampZoom(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_ZOOM;
  }
  return Math.min(MAX, Math.max(MIN, value));
}

/** The next stop above `current`, or `current` when already at the largest. */
export function zoomIn(current: number): number {
  const from = clampZoom(current);
  return ZOOM_STEPS.find((step) => step > from + EPSILON) ?? MAX;
}

/** The next stop below `current`, or `current` when already at the smallest. */
export function zoomOut(current: number): number {
  const from = clampZoom(current);
  const smaller = ZOOM_STEPS.filter((step) => step < from - EPSILON);
  return smaller.length > 0 ? smaller[smaller.length - 1] : MIN;
}

/** True when the scale is the unzoomed baseline — for a menu check mark. */
export function isDefaultZoom(scale: number): boolean {
  return Math.abs(clampZoom(scale) - DEFAULT_ZOOM) < EPSILON;
}

/** Whole-percent label for the UI: 1.25 → "125%". */
export function zoomLabel(scale: number): string {
  return `${Math.round(clampZoom(scale) * 100)}%`;
}

/**
 * `100%` is the browser's own root size, so the product is a real multiple of
 * whatever the user's system text size already is — we scale their baseline
 * rather than replacing it with ours.
 */
export function applyZoom(scale: number, root: HTMLElement): void {
  root.style.setProperty("--ui-zoom", String(clampZoom(scale)));
}
