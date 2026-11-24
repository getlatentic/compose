// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { durationMs, useLeaveAnimation } from "./useLeaveAnimation";

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.style.removeProperty("--motion-fast");
});

describe("durationMs", () => {
  it("reads milliseconds and seconds, and treats anything else as none", () => {
    expect(durationMs("150ms")).toBe(150);
    expect(durationMs(" 0.2s")).toBe(200);
    expect(durationMs("")).toBe(0);
  });
});

describe("useLeaveAnimation", () => {
  it("waits out the motion before acting, and acts once however often it is asked", () => {
    vi.useFakeTimers();
    document.documentElement.style.setProperty("--motion-fast", "150ms");
    const then = vi.fn();
    const { result } = renderHook(() => useLeaveAnimation());
    act(() => {
      result.current.leave(document.body, then);
      result.current.leave(document.body, then);
    });
    expect(result.current.leaving).toBe(true);
    expect(then).not.toHaveBeenCalled();
    vi.advanceTimersByTime(150);
    expect(then).toHaveBeenCalledTimes(1);
  });

  it("acts at once when Reduce Motion leaves no duration", () => {
    document.documentElement.style.setProperty("--motion-fast", "0ms");
    const then = vi.fn();
    const { result } = renderHook(() => useLeaveAnimation());
    act(() => result.current.leave(document.body, then));
    expect(then).toHaveBeenCalledTimes(1);
    expect(result.current.leaving).toBe(false);
  });
});
