import { useCallback } from "react";
import { Button, RadioButton, RadioButtonGroup } from "@carbon/react";
import { Add, Subtract } from "@carbon/react/icons";

import { useUiStore } from "../../app/store/uiStore";
import { normalizeTheme, type ThemeChoice } from "../../lib/theme/theme";
import {
  DEFAULT_ZOOM,
  ZOOM_STEPS,
  isDefaultZoom,
  zoomIn,
  zoomLabel,
  zoomOut,
} from "../../lib/zoom/zoom";

const SMALLEST = ZOOM_STEPS[0];
const LARGEST = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** Appearance: how the app looks, as opposed to how it behaves. */
export function AppearanceSection() {
  return (
    <>
      <ThemeControl />
      <TextSizeControl />
    </>
  );
}

/**
 * Three choices, not a toggle. "System" has to be a state of its own — a
 * light/dark switch cannot express "follow the Mac", and picking Light must
 * survive the machine going dark at sunset.
 */
function ThemeControl() {
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);

  const handleChange = useCallback(
    (value: string | number | undefined) => setTheme(normalizeTheme(value)),
    [setTheme],
  );

  return (
    <div className="settings-section">
      <h3 id="appearance-label">Appearance</h3>
      <RadioButtonGroup
        name="theme"
        legendText=""
        aria-labelledby="appearance-label"
        valueSelected={theme satisfies ThemeChoice}
        onChange={handleChange}
      >
        <RadioButton labelText="System" value="system" id="theme-system" />
        <RadioButton labelText="Light" value="light" id="theme-light" />
        <RadioButton labelText="Dark" value="dark" id="theme-dark" />
      </RadioButtonGroup>
      <p className="settings-helper">
        System follows your Mac, including when it changes at sunset.
      </p>
    </div>
  );
}

/**
 * Text size lives here as well as on the View menu. The menu is the macOS
 * convention and carries the shortcuts, but someone who needs bigger text is
 * exactly the person least likely to go hunting through a menu bar for it — so
 * it is visible, labelled, and shows the current value.
 */
function TextSizeControl() {
  const zoom = useUiStore((state) => state.zoom);
  const setZoom = useUiStore((state) => state.setZoom);

  const handleSmaller = useCallback(() => setZoom(zoomOut(zoom)), [setZoom, zoom]);
  const handleLarger = useCallback(() => setZoom(zoomIn(zoom)), [setZoom, zoom]);
  const handleReset = useCallback(() => setZoom(DEFAULT_ZOOM), [setZoom]);

  return (
    <div className="settings-section">
      <h3 id="text-size-label">Text size</h3>
      <div className="text-size" role="group" aria-labelledby="text-size-label">
        <Button
          hasIconOnly
          iconDescription="Smaller text"
          kind="tertiary"
          size="sm"
          renderIcon={Subtract}
          disabled={zoom <= SMALLEST}
          onClick={handleSmaller}
        />
        <output className="text-size__value" aria-live="polite">
          {zoomLabel(zoom)}
        </output>
        <Button
          hasIconOnly
          iconDescription="Larger text"
          kind="tertiary"
          size="sm"
          renderIcon={Add}
          disabled={zoom >= LARGEST}
          onClick={handleLarger}
        />
        <Button kind="ghost" size="sm" disabled={isDefaultZoom(zoom)} onClick={handleReset}>
          Reset
        </Button>
      </div>
      <p className="settings-helper">
        Scales the whole app, including your documents. Also on the View menu, as ⌘+ and ⌘−.
      </p>
    </div>
  );
}
