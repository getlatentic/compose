import { useEffect, useRef, useState } from "react";

/**
 * Hold a value on screen for at least `minMs` before switching to the
 * next one — so a fast-changing source (the live status, which can flip
 * several times a second as events stream) stays readable.
 *
 * Trailing-edge: while the minimum dwell is still running, incoming
 * changes are coalesced and only the *latest* is shown when the window
 * elapses — intermediate values that never got their turn are skipped,
 * not queued up to replay. A flip back to the currently-shown value
 * cancels any pending switch.
 *
 * Pure timing over a derived value (no events buffered), so it scales to
 * any update rate: at most one pending timer regardless of churn.
 */
export function useDwellValue<T>(value: T, minMs: number): T {
  const [shown, setShown] = useState<T>(value);
  // performance.now() avoids wall-clock jumps; ref so it survives renders.
  const shownAtRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    if (Object.is(value, shown)) {
      // Already showing it — cancel any switch that's no longer wanted.
      clear();
      return;
    }

    const elapsed = performance.now() - shownAtRef.current;
    const remaining = minMs - elapsed;

    const commit = () => {
      shownAtRef.current = performance.now();
      timerRef.current = null;
      setShown(value);
    };

    clear();
    if (remaining <= 0) {
      commit();
    } else {
      timerRef.current = window.setTimeout(commit, remaining);
    }

    return clear;
  }, [value, shown, minMs]);

  return shown;
}
