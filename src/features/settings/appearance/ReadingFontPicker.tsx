import { useCallback, type ChangeEvent } from "react";

import { useUiStore } from "../../../app/store/uiStore";
import { normalizeReadingFont, type ReadingFont } from "../../../lib/theme/reading";

const CARDS: readonly { font: ReadingFont; name: string; family: string }[] = [
  { font: "theme", name: "Theme", family: "Set by the theme" },
  { font: "serif", name: "Serif", family: "IBM Plex Serif" },
  { font: "sans", name: "Sans", family: "IBM Plex Sans" },
  { font: "mono", name: "Mono", family: "JetBrains Mono" },
  { font: "chalkboard", name: "Chalkboard", family: "Chalkboard SE" },
];

/**
 * The note font as five cards, each showing "Aa" in its own font. The card
 * sets `data-reading-font` on itself, so its sample resolves through the same
 * rules as the editor rather than a second list of font names.
 */
export function ReadingFontPicker() {
  const readingFont = useUiStore((state) => state.readingFont);
  const setReadingFont = useUiStore((state) => state.setReadingFont);

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setReadingFont(normalizeReadingFont(event.target.value)),
    [setReadingFont],
  );

  return (
    <div className="font-cards" role="radiogroup" aria-labelledby="reading-label">
      {CARDS.map((card) => (
        <label
          key={card.font}
          className={`font-card${card.font === readingFont ? " font-card--selected" : ""}`}
          data-reading-font={card.font}
        >
          <input
            type="radio"
            className="visually-hidden"
            name="reading-font"
            value={card.font}
            checked={card.font === readingFont}
            onChange={handleChange}
          />
          <span className="font-card__sample" aria-hidden>
            Aa
          </span>
          <span className="font-card__name">{card.name}</span>
          <span className="font-card__family">{card.family}</span>
        </label>
      ))}
    </div>
  );
}
