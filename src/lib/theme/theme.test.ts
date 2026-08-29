// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME,
  applyTheme,
  normalizeTheme,
  resolveTheme,
  type ThemeChoice,
} from "./theme";

describe("normalizeTheme", () => {
  it("keeps each of the three real choices", () => {
    for (const choice of ["system", "light", "dark"] as ThemeChoice[]) {
      expect(normalizeTheme(choice)).toBe(choice);
    }
  });

  it("falls back to following the system for anything else", () => {
    for (const junk of [undefined, null, "", "Dark", "auto", true, 1, {}]) {
      expect(normalizeTheme(junk)).toBe(DEFAULT_THEME);
    }
  });

  it("defaults to system, not light", () => {
    // The user's OS setting is already their answer; ignoring it and starting
    // light is a choice we have no basis to make.
    expect(DEFAULT_THEME).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("defers to the system only when asked to", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("holds an explicit choice against the system", () => {
    // The whole point of picking Light: it survives sunset.
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("applyTheme", () => {
  it("writes the attribute for an explicit choice", () => {
    const root = document.createElement("div");
    applyTheme("dark", root);
    expect(root.getAttribute("data-theme")).toBe("dark");
    applyTheme("light", root);
    expect(root.getAttribute("data-theme")).toBe("light");
  });

  it("REMOVES the attribute for system rather than writing the resolved value", () => {
    // Writing the resolved value would freeze the theme at whatever the system
    // was when the app started — the media query could never take effect again.
    const root = document.createElement("div");
    applyTheme("dark", root);
    applyTheme("system", root);
    expect(root.hasAttribute("data-theme")).toBe(false);
  });

  it("treats an unusable stored value as system", () => {
    const root = document.createElement("div");
    applyTheme("dark", root);
    applyTheme("nonsense" as ThemeChoice, root);
    expect(root.hasAttribute("data-theme")).toBe(false);
  });
});
