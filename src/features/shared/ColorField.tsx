import { useCallback, useEffect, useState, type ChangeEvent, type KeyboardEvent } from "react";

import { parseHexColor } from "../../lib/theme/hexColor";

interface ColorFieldProps {
  /** `#rrggbb`. */
  readonly value: string;
  readonly onChange: (color: string) => void;
  /** Names the swatch and the hex box for assistive technology. */
  readonly label: string;
}

/**
 * A colour as a swatch that opens the Mac's colour picker, beside a hex box
 * to type or paste one. The box takes effect on Return or on leaving it; an
 * entry that is not a colour goes back to the current one.
 */
export function ColorField({ value, onChange, label }: ColorFieldProps) {
  const [draft, setDraft] = useState(value.toUpperCase());
  useEffect(() => setDraft(value.toUpperCase()), [value]);

  const pick = useCallback((event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value), [onChange]);
  const type = useCallback((event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value), []);
  const commit = useCallback(() => {
    const color = parseHexColor(draft);
    if (color && color !== value.toLowerCase()) onChange(color);
    else setDraft(value.toUpperCase());
  }, [draft, value, onChange]);
  const onKey = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") commit();
    },
    [commit],
  );

  return (
    <span className="color-field">
      <input type="color" value={value} onChange={pick} aria-label={label} />
      <input
        type="text"
        className="color-field__hex"
        value={draft}
        onChange={type}
        onBlur={commit}
        onKeyDown={onKey}
        aria-label={`${label}, hex`}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        maxLength={7}
      />
    </span>
  );
}
