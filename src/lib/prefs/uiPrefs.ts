/**
 * Persisted UI preferences that aren't tied to a harness or a workspace —
 * small, global toggles (e.g. the run-finished sound). Kept separate from
 * `HarnessPrefs` (selection / edits / run options) so each prefs store
 * owns one concern.
 */

const UI_PREFS_KEY = "compose.uiPrefs.v1";

export interface UiPrefs {
  /** Play a subtle chime when an assistant run finishes. */
  soundOnComplete: boolean;
}

const FALLBACK: UiPrefs = { soundOnComplete: true };

export function loadUiPrefs(): UiPrefs {
  if (typeof localStorage === "undefined") {
    return FALLBACK;
  }
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    if (!raw) {
      return FALLBACK;
    }
    const parsed = JSON.parse(raw) as Partial<UiPrefs>;
    return {
      soundOnComplete:
        typeof parsed.soundOnComplete === "boolean"
          ? parsed.soundOnComplete
          : FALLBACK.soundOnComplete,
    };
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
