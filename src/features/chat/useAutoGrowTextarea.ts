import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Grow a textarea with its content: collapse to `auto`, then set height
 * to `scrollHeight`. The element's CSS `max-block-size` clamps the
 * result (the browser caps an explicit height against max-height) and
 * `overflow-y: auto` takes over past the cap, so the box grows up to a
 * ceiling and then scrolls.
 *
 * Re-measures whenever `value` changes — including the reset to `""`
 * after a send — so the box snaps back to one row. The textarea must be
 * `box-sizing: border-box` for the `scrollHeight` math to line up with
 * padding (the global textarea reset sets this).
 */
export function useAutoGrowTextarea<T extends HTMLTextAreaElement>(value: string) {
  const ref = useRef<T | null>(null);

  const resize = useCallback(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    resize();
  }, [value, resize]);

  return ref;
}
