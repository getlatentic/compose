import { useCallback, useRef, useState } from "react";

/** `"150ms"` / `"0.15s"` → milliseconds; anything else (unset, jsdom) is 0. */
export function durationMs(value: string): number {
  const amount = parseFloat(value);
  if (!Number.isFinite(amount)) return 0;
  return value.trim().endsWith("ms") ? amount : amount * 1000;
}

/**
 * Lets an element play its leave animation before the action that removes it.
 * The wait is `--motion-fast` read from the element, so Reduce Motion (which
 * zeroes it) runs the action at once. A second call while leaving is ignored.
 */
export function useLeaveAnimation(): { leaving: boolean; leave: (element: Element, then: () => void) => void } {
  const [leaving, setLeaving] = useState(false);
  const started = useRef(false);
  const leave = useCallback((element: Element, then: () => void) => {
    if (started.current) return;
    started.current = true;
    const wait = durationMs(getComputedStyle(element).getPropertyValue("--motion-fast"));
    if (wait === 0) {
      then();
      return;
    }
    setLeaving(true);
    window.setTimeout(then, wait);
  }, []);
  return { leaving, leave };
}
