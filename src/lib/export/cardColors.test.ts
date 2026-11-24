import { describe, expect, it } from "vitest";

import { flatten, parseCssColor, cardColorsOn } from "./cardColors";

describe("card colours", () => {
  it("reads the colour forms a browser computes", () => {
    expect(parseCssColor("rgb(31, 29, 26)")).toEqual([31, 29, 26, 1]);
    expect(parseCssColor("rgba(0, 0, 0, 0.5)")).toEqual([0, 0, 0, 0.5]);
    expect(parseCssColor("color(srgb 1 0.5 0 / 0.55)")).toEqual([255, 127.5, 0, 0.55]);
    expect(parseCssColor("hotpink")).toBeNull();
  });

  it("flattens a translucent colour onto the page it sits on", () => {
    expect(flatten([0, 0, 0, 0.5], [255, 255, 255, 1])).toBe("#808080");
    expect(flatten([200, 55, 45, 1], [255, 255, 255, 1])).toBe("#c8372d");
  });
});

describe("cardColorsOn", () => {
  it("writes dark ink on a light card and light ink on a dark one", () => {
    expect(cardColorsOn("#f2cf4b")).toMatchObject({ background: "#f2cf4b", ink: "#1f1d1a" });
    expect(cardColorsOn("#1c1b1a")).toMatchObject({ background: "#1c1b1a", ink: "#f2efea" });
  });
});
