import { describe, expect, it } from "vitest";

import { parseHexColor } from "./hexColor";

describe("parseHexColor", () => {
  it("reads six or three digits, with or without #, in any case", () => {
    expect(parseHexColor("#F2CF4B")).toBe("#f2cf4b");
    expect(parseHexColor("f2cf4b")).toBe("#f2cf4b");
    expect(parseHexColor(" #abc ")).toBe("#aabbcc");
  });

  it("refuses what is not a colour", () => {
    for (const text of ["", "#12345", "red", "#ggg000", "#f2cf4b0"]) {
      expect(parseHexColor(text)).toBeNull();
    }
  });
});
