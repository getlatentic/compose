// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { applyNoteBackground, inkFor, normalizeNoteBackground } from "./noteBackground";

afterEach(() => {
  const root = document.documentElement;
  root.removeAttribute("data-note-bg");
  root.removeAttribute("data-note-ink");
  root.removeAttribute("style");
});

describe("normalizeNoteBackground", () => {
  it("keeps a well-formed choice and reads anything else as the theme's", () => {
    expect(normalizeNoteBackground({ kind: "color", color: "#ABCDEF" })).toEqual({ kind: "color", color: "#abcdef" });
    expect(normalizeNoteBackground({ kind: "color", color: "red" })).toEqual({ kind: "theme" });
    expect(normalizeNoteBackground({ kind: "image", file: "/a.jpg", fit: "odd", dim: 4 })).toEqual({ kind: "image", file: "/a.jpg", fit: "fill", dim: 0.95 });
    expect(normalizeNoteBackground(undefined)).toEqual({ kind: "theme" });
  });
});

describe("inkFor", () => {
  it("writes dark on a light page and light on a dark one", () => {
    expect(inkFor("#f4efe6")).toBe("dark");
    expect(inkFor("#1d2433")).toBe("light");
    expect(inkFor("#f0cf4c")).toBe("dark");
  });
});

describe("applyNoteBackground", () => {
  it("sets a colour and its ink, and clears them when the theme's page comes back", () => {
    const root = document.documentElement;
    applyNoteBackground({ kind: "color", color: "#1d2433" }, root, (file) => file);
    expect(root.getAttribute("data-note-ink")).toBe("light");
    expect(root.style.getPropertyValue("--note-bg-color")).toBe("#1d2433");
    applyNoteBackground({ kind: "theme" }, root, (file) => file);
    expect(root.getAttribute("data-note-bg")).toBe("theme");
    expect(root.hasAttribute("data-note-ink")).toBe(false);
    expect(root.style.getPropertyValue("--note-bg-color")).toBe("");
  });

  it("loads an image through the resolver given, with its fit and strength", () => {
    const root = document.documentElement;
    applyNoteBackground({ kind: "image", file: "/bg/a b.jpg", fit: "tile", dim: 0.4 }, root, (file) => `asset://${file}`);
    expect(root.style.getPropertyValue("--note-bg-image")).toBe('url("asset:///bg/a b.jpg")');
    expect(root.style.getPropertyValue("--note-bg-dim")).toBe("40%");
    expect(root.style.getPropertyValue("--note-bg-repeat")).toBe("repeat");
  });
});
