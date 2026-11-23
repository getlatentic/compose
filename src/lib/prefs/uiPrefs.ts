/**
 * Persisted UI preferences that aren't tied to a harness or a workspace —
 * small, global toggles (e.g. the run-finished sound). Kept separate from
 * `HarnessPrefs` (selection / edits / run options) so each prefs store
 * owns one concern.
 */

import { normalizePalette } from "../theme/palettes";
import type { Appearance } from "../theme/appearance";
import { normalizeCustomFont, normalizeReadingFont, normalizeReadingSize } from "../theme/reading";
import { normalizeExportFont, type ExportFont } from "../theme/exportFont";
import { normalizeNoteBackground, type NoteBackground } from "../theme/noteBackground";
import { normalizeEditorScheme, normalizeTheme } from "../theme/theme";
import { clampZoom } from "../zoom/zoom";

const UI_PREFS_KEY = "compose.uiPrefs.v1";

export interface UiPrefs extends Appearance {
  /** Play a subtle chime when an assistant run finishes. */
  soundOnComplete: boolean;
  /** Send an anonymous app-open signal so active users can be counted. Opt-out
   *  (defaults on); honoured only when a build also carries GA4 credentials. */
  analyticsEnabled: boolean;
  /** Focus mode: sidebar + chat hidden, the document centered. A
   *  writing posture worth keeping across restarts. */
  focusMode: boolean;
  /** The formatting buttons above the note folded away, leaving the row's
   *  file actions. A preference about the workspace, so it is kept. */
  formatBarCollapsed: boolean;
  /** User-dragged pane widths in px; null = the default grid width. */
  sidebarWidthPx: number | null;
  chatWidthPx: number | null;
  /** Interface scale (⌘+ / ⌘− / ⌘0). 1 = the system text size, untouched. */
  zoom: number;
  /** The font exports use: the note's, or Latin Modern. */
  exportFont: ExportFont;
  /** What sits behind the note: the theme's page, a colour, or an image. */
  noteBackground: NoteBackground;
}

function booleanOr(fallback: boolean): (value: unknown) => boolean {
  return (value) => (typeof value === "boolean" ? value : fallback);
}

function widthOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Each preference's reader: whatever was stored (or nothing) in, a valid
 * value out. The one place a preference is checked; everything past it
 * trusts the value.
 */
const READERS: { readonly [K in keyof UiPrefs]: (value: unknown) => UiPrefs[K] } = {
  soundOnComplete: booleanOr(true),
  analyticsEnabled: booleanOr(true),
  focusMode: booleanOr(false),
  formatBarCollapsed: booleanOr(false),
  sidebarWidthPx: widthOrNull,
  chatWidthPx: widthOrNull,
  zoom: clampZoom,
  theme: normalizeTheme,
  palette: normalizePalette,
  readingFont: normalizeReadingFont,
  readingSize: normalizeReadingSize,
  customFont: normalizeCustomFont,
  exportFont: normalizeExportFont,
  noteBackground: normalizeNoteBackground,
  editorScheme: normalizeEditorScheme,
};

const PREF_KEYS = Object.keys(READERS) as (keyof UiPrefs)[];

/** A valid value for `key` from anything: the stored value, or a setter's argument. */
export function readPref<K extends keyof UiPrefs>(key: K, value: unknown): UiPrefs[K] {
  return READERS[key](value);
}

function readAll(source: Partial<Record<keyof UiPrefs, unknown>>): UiPrefs {
  const prefs = {} as Record<keyof UiPrefs, unknown>;
  for (const key of PREF_KEYS) prefs[key] = readPref(key, source[key]);
  return prefs as UiPrefs;
}

/** The preferences out of a larger object that holds them, such as the UI store. */
export function pickUiPrefs(source: UiPrefs): UiPrefs {
  const prefs = {} as Record<keyof UiPrefs, unknown>;
  for (const key of PREF_KEYS) prefs[key] = source[key];
  return prefs as UiPrefs;
}

const FALLBACK: UiPrefs = readAll({});

export function loadUiPrefs(): UiPrefs {
  if (typeof localStorage === "undefined") {
    return FALLBACK;
  }
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    return raw ? readAll(JSON.parse(raw) as Partial<Record<keyof UiPrefs, unknown>>) : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export function persistUiPrefs(prefs: UiPrefs): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Best-effort; ignore quota / availability errors.
  }
}
