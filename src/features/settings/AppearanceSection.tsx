import { useCallback } from "react";

import { useUiStore } from "../../app/store/uiStore";
import {
  DEFAULT_ZOOM,
  ZOOM_STEPS,
  isDefaultZoom,
  zoomIn,
  zoomLabel,
  zoomOut,
} from "../../lib/zoom/zoom";
import { ThemePicker } from "./ThemePicker";

const SMALLEST = ZOOM_STEPS[0];
const LARGEST = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/** Appearance: how the app looks, as opposed to how it behaves. */
export function AppearanceSection() {
  return (
    <>
      <div className="settings-section">
        <h3 id="appearance-label">Appearance</h3>
        <ThemePicker />
        <p className="settings-helper">
          System follows your Mac, including when it changes at sunset.
        </p>
      </div>
      <TextSizeControl />
    </>
  );
}

/**
 * Text size lives here as well as on the View menu. The menu is the macOS
 * convention and carries the shortcuts, but someone who needs bigger text is
 * exactly the person least likely to go hunting through a menu bar for it — so
 * it is visible, labelled, and shows the current value.
 *
 * Plain buttons rather than Carbon's: at `size="sm"` those are 32px icon
 * targets built for toolbars, which read as far too heavy for a preference row
 * sitting beside a number.
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
        <span className="text-size__group">
          <button
            type="button"
            className="text-size__step"
            aria-label="Smaller text"
            disabled={zoom <= SMALLEST}
            onClick={handleSmaller}
          >
            −
          </button>
          <output className="text-size__value" aria-live="polite">
            {zoomLabel(zoom)}
          </output>
          <button
            type="button"
            className="text-size__step"
            aria-label="Larger text"
            disabled={zoom >= LARGEST}
            onClick={handleLarger}
          >
            +
          </button>
        </span>
        <button
          type="button"
          className="settings-link-button"
          disabled={isDefaultZoom(zoom)}
          onClick={handleReset}
        >
          Reset
        </button>
      </div>
      <p className="settings-helper">
        Scales the whole app, including your documents. Also on the View menu, as ⌘+ and ⌘−.
      </p>
    </div>
  );
}
