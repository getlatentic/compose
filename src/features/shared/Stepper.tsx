interface StepperProps {
  /** Id of the visible label that names the control. */
  readonly labelledBy: string;
  /** The current value as shown, e.g. "110%" or "18 px". */
  readonly valueLabel: string;
  readonly decreaseLabel: string;
  readonly increaseLabel: string;
  readonly canDecrease: boolean;
  readonly canIncrease: boolean;
  readonly onDecrease: () => void;
  readonly onIncrease: () => void;
}

/** A value between − and + buttons, as in the Mac's own number steppers. */
export function Stepper({
  labelledBy,
  valueLabel,
  decreaseLabel,
  increaseLabel,
  canDecrease,
  canIncrease,
  onDecrease,
  onIncrease,
}: StepperProps) {
  return (
    <span className="stepper" role="group" aria-labelledby={labelledBy}>
      <button type="button" className="stepper__step" aria-label={decreaseLabel} disabled={!canDecrease} onClick={onDecrease}>
        −
      </button>
      <output className="stepper__value" aria-live="polite">
        {valueLabel}
      </output>
      <button type="button" className="stepper__step" aria-label={increaseLabel} disabled={!canIncrease} onClick={onIncrease}>
        +
      </button>
    </span>
  );
}
