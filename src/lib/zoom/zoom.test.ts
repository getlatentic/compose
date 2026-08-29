// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  DEFAULT_ZOOM,
  ZOOM_STEPS,
  applyZoom,
  clampZoom,
  isDefaultZoom,
  zoomIn,
  zoomLabel,
  zoomOut,
} from "./zoom";

describe("clampZoom", () => {
  it("keeps a value that is already in range", () => {
    expect(clampZoom(1.25)).toBe(1.25);
  });

  it("holds the ends rather than running past them", () => {
    expect(clampZoom(99)).toBe(ZOOM_STEPS[ZOOM_STEPS.length - 1]);
    expect(clampZoom(0.01)).toBe(ZOOM_STEPS[0]);
  });

  it("falls back to the default for anything unusable", () => {
    // A hand-edited prefs file, or a value from a build that stored something else.
    for (const junk of [undefined, null, "1.5", NaN, Infinity, {}]) {
      expect(clampZoom(junk)).toBe(DEFAULT_ZOOM);
    }
  });
});

describe("stepping", () => {
  it("walks up and back down through every stop", () => {
    let scale: number = ZOOM_STEPS[0];
    const up: number[] = [scale];
    for (let i = 0; i < ZOOM_STEPS.length; i += 1) {
      scale = zoomIn(scale);
      up.push(scale);
    }
    // The last press has nothing above it, so the maximum repeats.
    expect(up).toEqual([...ZOOM_STEPS, ZOOM_STEPS[ZOOM_STEPS.length - 1]]);

    let back = scale;
    for (let i = 0; i < ZOOM_STEPS.length; i += 1) {
      back = zoomOut(back);
    }
    expect(back).toBe(ZOOM_STEPS[0]);
  });

  it("stops at the ends instead of wrapping", () => {
    const max = ZOOM_STEPS[ZOOM_STEPS.length - 1];
    expect(zoomIn(max)).toBe(max);
    expect(zoomOut(ZOOM_STEPS[0])).toBe(ZOOM_STEPS[0]);
  });

  it("does not skip a stop the value has drifted off by a float", () => {
    // 1.25 can come back from JSON as 1.2500000000000002; a naive `step > from`
    // would treat 1.25 as already passed and jump to 1.5.
    expect(zoomIn(1.2500000000000002)).toBe(1.5);
    expect(zoomOut(1.2499999999999998)).toBe(1.1);
  });

  it("lands on a real stop from a value that is between two", () => {
    expect(zoomIn(1.2)).toBe(1.25);
    expect(zoomOut(1.2)).toBe(1.1);
  });
});

describe("presentation", () => {
  it("labels the scale in whole percent", () => {
    expect(zoomLabel(1)).toBe("100%");
    expect(zoomLabel(1.25)).toBe("125%");
    expect(zoomLabel(0.8)).toBe("80%");
  });

  it("recognises the baseline through float drift", () => {
    expect(isDefaultZoom(1)).toBe(true);
    expect(isDefaultZoom(1.0000000000000002)).toBe(true);
    expect(isDefaultZoom(1.1)).toBe(false);
  });
});

describe("applyZoom", () => {
  it("writes the scale as a custom property on the given root", () => {
    const root = document.createElement("div");
    applyZoom(1.5, root);
    expect(root.style.getPropertyValue("--ui-zoom")).toBe("1.5");
  });

  it("never writes a value outside the range, whatever it is handed", () => {
    const root = document.createElement("div");
    applyZoom(50, root);
    expect(root.style.getPropertyValue("--ui-zoom")).toBe(
      String(ZOOM_STEPS[ZOOM_STEPS.length - 1]),
    );
  });
});
