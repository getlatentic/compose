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
  /** Send an anonymous app-open signal so active users can be counted. Opt-out
   *  (defaults on); honoured only when a build also carries GA4 credentials. */
  analyticsEnabled: boolean;
  /** Focus mode (#126): sidebar + chat hidden, the document centered. A
   *  writing posture worth keeping across restarts. */
  focusMode: boolean;
}

const FALLBACK: UiPrefs = { soundOnComplete: true, analyticsEnabled: true, focusMode: false };

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
      analyticsEnabled:
        typeof parsed.analyticsEnabled === "boolean"
          ? parsed.analyticsEnabled
          : FALLBACK.analyticsEnabled,
      focusMode: typeof parsed.focusMode === "boolean" ? parsed.focusMode : FALLBACK.focusMode,
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
