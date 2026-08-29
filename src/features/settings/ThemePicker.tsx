import { useCallback } from "react";

import { useUiStore } from "../../app/store/uiStore";
import { THEME_CHOICES, normalizeTheme, type ThemeChoice } from "../../lib/theme/theme";

const LABELS: Record<ThemeChoice, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/**
 * Theme as three small previews rather than three words.
 *
 * A radio list makes you read "Light / Dark" and imagine the result; a preview
 * shows it, which is the whole content of the choice. The System tile is split
 * down the middle because that is what it means — whichever the Mac is.
 *
 * Real radio inputs underneath, visually hidden: arrow keys move through the
 * group, the label is announced, and the tile is only the paint.
 */
export function ThemePicker() {
  const theme = useUiStore((state) => state.theme);
  const setTheme = useUiStore((state) => state.setTheme);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => setTheme(normalizeTheme(event.target.value)),
    [setTheme],
  );

  return (
    <div className="theme-picker" role="radiogroup" aria-labelledby="appearance-label">
      {THEME_CHOICES.map((choice) => (
        <label
          key={choice}
          className={`theme-option${theme === choice ? " theme-option--selected" : ""}`}
        >
          <input
            type="radio"
            name="theme"
            value={choice}
            checked={theme === choice}
            onChange={handleChange}
            className="theme-option__input"
          />
          <span className={`theme-preview theme-preview--${choice}`} aria-hidden>
            <span className="theme-preview__sidebar" />
            <span className="theme-preview__body">
              <span className="theme-preview__line theme-preview__line--title" />
              <span className="theme-preview__line" />
              <span className="theme-preview__line theme-preview__line--short" />
            </span>
          </span>
          <span className="theme-option__label">{LABELS[choice]}</span>
        </label>
      ))}
    </div>
  );
}
