// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { enableMotionAfterLaunch } from "./motion";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-motion");
});

describe("enableMotionAfterLaunch", () => {
  it("waits for the window to draw, not for time to pass, then turns enter animations on", () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    const root = document.documentElement;
    enableMotionAfterLaunch(root);

    vi.advanceTimersByTime(10_000);
    expect(root.hasAttribute("data-motion")).toBe(false);

    frames.shift()!(0);
    frames.shift()!(16);
    vi.advanceTimersByTime(400);
    expect(root.getAttribute("data-motion")).toBe("on");
  });
});
