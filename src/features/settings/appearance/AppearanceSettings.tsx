import { useUiStore } from "../../../app/store/uiStore";
import type { ReadingSize } from "../../../lib/theme/reading";
import type { ThemeChoice } from "../../../lib/theme/theme";
import { SegmentedControl, type SegmentOption } from "../../shared/SegmentedControl";
import { PalettePicker } from "./PalettePicker";
import { ReadingFontPicker } from "./ReadingFontPicker";
import { ZoomControl } from "./ZoomControl";

const APPEARANCE_OPTIONS: readonly SegmentOption<ThemeChoice>[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match Mac" },
];

const SIZE_OPTIONS: readonly SegmentOption<ReadingSize>[] = [
  { value: "small", label: "Small" },
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
];

/** Settings → Appearance: how the app and the notes look. */
export function AppearanceSettings() {
  return (
    <div className="appearance-settings">
      <section className="appearance-settings__group" aria-labelledby="palette-label">
        <h3 id="palette-label">Theme</h3>
        <p className="settings-helper">Colours and fonts for the app and your notes. Each comes in light and dark.</p>
        <PalettePicker />
        <AppearanceRow />
      </section>
      <section className="appearance-settings__group" aria-labelledby="reading-label">
        <h3 id="reading-label">Reading</h3>
        <p className="settings-helper">The font for your notes. Theme uses the one each theme was designed with.</p>
        <ReadingFontPicker />
        <ReadingSizeRow />
        <ReadingPreview />
      </section>
      <section className="appearance-settings__group" aria-labelledby="zoom-label">
        <ZoomControl />
      </section>
    </div>
  );
}

function AppearanceRow() {
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);
  return (
    <div className="appearance-settings__row">
      <span id="appearance-label" className="appearance-settings__row-label">
        Appearance
      </span>
      <SegmentedControl
        name="appearance"
        labelledBy="appearance-label"
        options={APPEARANCE_OPTIONS}
        value={theme}
        onChange={setTheme}
      />
    </div>
  );
}

function ReadingSizeRow() {
  const readingSize = useUiStore((state) => state.readingSize);
  const setReadingSize = useUiStore((state) => state.setReadingSize);
  return (
    <div className="appearance-settings__row">
      <span id="reading-size-label" className="appearance-settings__row-label">
        Text size
      </span>
      <SegmentedControl
        name="reading-size"
        labelledBy="reading-size-label"
        options={SIZE_OPTIONS}
        value={readingSize}
        onChange={setReadingSize}
      />
    </div>
  );
}

/** A heading and a paragraph in the note styles, so a change shows before you leave Settings. */
function ReadingPreview() {
  return (
    <figure className="reading-preview" aria-label="Preview">
      <p className="reading-preview__heading">Why plain files</p>
      <p className="reading-preview__body">
        A note should outlive the app it was written in. Plain markdown means your words move with you, to another
        editor, another computer, another decade.
      </p>
    </figure>
  );
}
