import { useCallback } from "react";

import { useUiStore } from "../../../app/store/uiStore";
import {
  DEFAULT_ZOOM,
  ZOOM_STEPS,
  isDefaultZoom,
  zoomIn,
  zoomLabel,
  zoomOut,
} from "../../../lib/zoom/zoom";
import { Stepper } from "../../shared/Stepper";

const SMALLEST = ZOOM_STEPS[0];
const LARGEST = ZOOM_STEPS[ZOOM_STEPS.length - 1];

/**
 * App zoom: the whole window, chrome and notes alike, where Editor → Text
 * size changes only the notes. The View menu carries the shortcuts, but someone who
 * needs everything larger is the least likely to go looking in a menu bar, so
 * it is visible here and shows the current value.
 */
export function ZoomControl() {
  const zoom = useUiStore((state) => state.zoom);
  const setZoom = useUiStore((state) => state.setZoom);

  const handleSmaller = useCallback(() => setZoom(zoomOut(zoom)), [setZoom, zoom]);
  const handleLarger = useCallback(() => setZoom(zoomIn(zoom)), [setZoom, zoom]);
  const handleReset = useCallback(() => setZoom(DEFAULT_ZOOM), [setZoom]);

  return (
    <>
      <div className="appearance-settings__row">
        <span id="zoom-label" className="appearance-settings__row-label">
          Zoom
        </span>
        <div className="zoom-control">
          <Stepper
            labelledBy="zoom-label"
            valueLabel={zoomLabel(zoom)}
            decreaseLabel="Zoom out"
            increaseLabel="Zoom in"
            canDecrease={zoom > SMALLEST}
            canIncrease={zoom < LARGEST}
            onDecrease={handleSmaller}
            onIncrease={handleLarger}
          />
          <button
            type="button"
            className="settings-link-button"
            disabled={isDefaultZoom(zoom)}
            onClick={handleReset}
          >
            Reset
          </button>
        </div>
      </div>
      <p className="settings-helper">Scales the whole app. Also on the View menu, as ⌘+ and ⌘−.</p>
    </>
  );
}
