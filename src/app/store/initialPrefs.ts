import { loadUiPrefs } from "../../lib/prefs/uiPrefs";
import { loadHarnessPrefs } from "./harnessConfig";

/** Persisted harness selection + edit permission + per-harness options, read
 * once at module load to seed the harness slice's initial state. */
export const INITIAL_HARNESS_PREFS = loadHarnessPrefs();
/** Persisted UI preferences (e.g. completion chime), read once to seed the
 * UI slice's initial state. */
export const INITIAL_UI_PREFS = loadUiPrefs();
