import { describe, expect, it } from "vitest";

import { exportTypefacesFor } from "./exportTypefaces";

const base = { palette: "walnut", readingFont: "theme" as const, customFont: null, exportFont: "note" as const };

describe("exportTypefacesFor", () => {
  it("asks for the LaTeX look by sending nothing", () => {
    expect(exportTypefacesFor({ ...base, exportFont: "latex" })).toBeUndefined();
  });

  it("follows the theme's own fonts when the reading font is the theme's", () => {
    expect(exportTypefacesFor(base)).toEqual({
      body: { kind: "bundled", face: "plexSerif" },
      heading: { kind: "bundled", face: "plexSans" },
      code: { kind: "bundled", face: "jetbrainsMono" },
    });
    expect(exportTypefacesFor({ ...base, palette: "classic" })?.body).toEqual({ kind: "system", font: "sans" });
  });

  it("sets New York through the system's serif, and an installed font by its name", () => {
    expect(exportTypefacesFor({ ...base, readingFont: "newYork" })?.body).toEqual({ kind: "system", font: "serif" });
    expect(exportTypefacesFor({ ...base, readingFont: "custom", customFont: "Avenir Next" })?.heading).toEqual({
      kind: "installed",
      family: "Avenir Next",
    });
  });

  it("reads a custom choice with no font as the theme's", () => {
    expect(exportTypefacesFor({ ...base, readingFont: "custom", customFont: null })).toEqual(exportTypefacesFor(base));
  });
});
