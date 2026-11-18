import { useCallback, type ChangeEvent } from "react";

import { useUiStore } from "../../../app/store/uiStore";
import { PALETTES } from "../../../lib/theme/palettes";

/**
 * The colour themes as small windows rather than names. Each swatch sets
 * `data-palette` on its own preview, so it draws in that palette, in the
 * window's current light or dark, while the label around it keeps the
 * window's colours.
 */
export function PalettePicker() {
  const palette = useUiStore((state) => state.palette);
  const setPalette = useUiStore((state) => state.setPalette);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setPalette(event.target.value),
    [setPalette],
  );

  return (
    <div className="palette-picker" role="radiogroup" aria-labelledby="palette-label">
      {PALETTES.map((entry) => (
        <label
          key={entry.id}
          className={`palette-option${entry.id === palette ? " palette-option--selected" : ""}`}
        >
          <input
            type="radio"
            className="visually-hidden"
            name="palette"
            value={entry.id}
            checked={entry.id === palette}
            onChange={handleChange}
          />
          <span className="palette-swatch" data-palette={entry.id} aria-hidden>
            <span className="palette-swatch__sidebar">
              <span className="palette-swatch__row" />
              <span className="palette-swatch__row" />
              <span className="palette-swatch__row palette-swatch__row--marker" />
            </span>
            <span className="palette-swatch__page">
              <span className="palette-swatch__title" />
              <span className="palette-swatch__rule" />
              <span className="palette-swatch__line" />
              <span className="palette-swatch__line" />
              <span className="palette-swatch__line palette-swatch__line--short" />
              <span className="palette-swatch__button" />
            </span>
          </span>
          <span className="palette-option__label">{entry.label}</span>
        </label>
      ))}
    </div>
  );
}
