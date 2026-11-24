import { useCallback, type ChangeEvent } from "react";

export interface SegmentOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
}

interface SegmentedControlProps<Value extends string> {
  /** Groups the radios; unique per control on the page. */
  readonly name: string;
  /** Id of the visible label that names the group. */
  readonly labelledBy: string;
  readonly options: readonly SegmentOption<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}

/**
 * A macOS segmented control: one choice out of a few, all visible.
 *
 * Real radio inputs underneath, visually hidden: arrow keys move through the
 * group and the label is announced. The segment is only the paint.
 */
export function SegmentedControl<Value extends string>({
  name,
  labelledBy,
  options,
  value,
  onChange,
}: SegmentedControlProps<Value>) {
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const chosen = options.find((option) => option.value === event.target.value);
      if (chosen) {
        onChange(chosen.value);
      }
    },
    [onChange, options],
  );

  return (
    <div className="segmented" role="radiogroup" aria-labelledby={labelledBy}>
      {options.map((option) => (
        <label
          key={option.value}
          className={`segmented__option${option.value === value ? " segmented__option--selected" : ""}`}
        >
          <input
            type="radio"
            className="visually-hidden"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={handleChange}
          />
          <span className="segmented__label">{option.label}</span>
        </label>
      ))}
    </div>
  );
}
