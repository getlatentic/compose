import { useUiStore } from "../../../app/store/uiStore";
import type { ThemeChoice } from "../../../lib/theme/theme";
import { SegmentedControl, type SegmentOption } from "../../shared/SegmentedControl";
import { ZoomControl } from "./ZoomControl";

const APPEARANCE_OPTIONS: readonly SegmentOption<ThemeChoice>[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match Mac" },
];

/**
 * Settings → Appearance: the app around your notes, which sits on the Mac's
 * own glass and accent colour. How the notes themselves look is Settings →
 * Editor.
 */
export function AppearanceSettings() {
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  return (
    <div className="appearance-settings">
      <section className="appearance-settings__group" aria-labelledby="app-appearance-label">
        <h3 id="app-appearance-label">App</h3>
        <div className="appearance-settings__row">
          <span id="appearance-label" className="appearance-settings__row-label">
            Appearance
          </span>
          <SegmentedControl name="appearance" labelledBy="appearance-label" options={APPEARANCE_OPTIONS} value={theme} onChange={setTheme} />
        </div>
        <p className="settings-helper">The sidebar and window follow your Mac's glass and accent colour. Notes have their own look in Editor.</p>
      </section>
      <section className="appearance-settings__group" aria-labelledby="zoom-label">
        <ZoomControl />
      </section>
    </div>
  );
}
