// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { applyReadingStyle, cssFamily, normalizeCustomFont, normalizeReadingSize } from "./reading";

afterEach(() => {
  const root = document.documentElement;
  root.removeAttribute("data-reading-font");
  root.style.removeProperty("--font-custom");
  root.style.removeProperty("--reading-base");
});

describe("the reading font", () => {
  it("puts an installed font on the root as a quoted family, safe for any name", () => {
    applyReadingStyle("custom", 18, 'Ed "Quote" \\ Sans', document.documentElement);
    expect(document.documentElement.getAttribute("data-reading-font")).toBe("custom");
    expect(document.documentElement.style.getPropertyValue("--font-custom")).toBe(cssFamily('Ed "Quote" \\ Sans'));
    expect(cssFamily('Ed "Quote" \\ Sans')).toBe('"Ed \\"Quote\\" \\\\ Sans"');
  });

  it("reads a custom choice without a font as the theme's, and clears the old name", () => {
    applyReadingStyle("custom", 18, "Avenir", document.documentElement);
    applyReadingStyle("custom", 18, null, document.documentElement);
    expect(document.documentElement.getAttribute("data-reading-font")).toBe("theme");
    expect(document.documentElement.style.getPropertyValue("--font-custom")).toBe("");
  });

  it("keeps only names that could be a font family", () => {
    expect(normalizeCustomFont("  Charter  ")).toBe("Charter");
    expect(normalizeCustomFont("")).toBeNull();
    expect(normalizeCustomFont("x".repeat(200))).toBeNull();
    expect(normalizeCustomFont(42)).toBeNull();
  });
});

describe("normalizeReadingSize", () => {
  it("keeps whole pixel sizes inside the range, and reads old names and junk sensibly", () => {
    expect(normalizeReadingSize(21)).toBe(21);
    expect(normalizeReadingSize(17.6)).toBe(18);
    expect(normalizeReadingSize(4)).toBe(12);
    expect(normalizeReadingSize(90)).toBe(32);
    expect(normalizeReadingSize("small")).toBe(16);
    expect(normalizeReadingSize(Number.NaN)).toBe(18);
    expect(normalizeReadingSize("toString")).toBe(18);
  });

  it("puts the size on the root in rem, so app zoom still scales it", () => {
    applyReadingStyle("theme", 20, null, document.documentElement);
    expect(document.documentElement.style.getPropertyValue("--reading-base")).toBe("1.25rem");
  });
});
