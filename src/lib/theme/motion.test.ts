// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { enableMotionAfterLaunch } from "./motion";

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute("data-motion");
});

describe("enableMotionAfterLaunch", () => {
  it("keeps the first screen still, then turns enter animations on", () => {
    vi.useFakeTimers();
    const root = document.documentElement;
    enableMotionAfterLaunch(root);
    expect(root.hasAttribute("data-motion")).toBe(false);
    vi.advanceTimersByTime(600);
    expect(root.getAttribute("data-motion")).toBe("on");
  });
});
