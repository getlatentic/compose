// @vitest-environment jsdom
//
// The UI-prefs store behind small persisted toggles. Focus mode (#126) rides
// here: the AC says the writing posture survives restarts, which means one
// load/persist round trip plus graceful handling of older payloads that
// predate the field.
import { afterEach, describe, expect, it } from "vitest";

import { loadUiPrefs, persistUiPrefs } from "./uiPrefs";

afterEach(() => {
  localStorage.clear();
});

describe("uiPrefs", () => {
  it("defaults focus mode off on first run", () => {
    expect(loadUiPrefs().focusMode).toBe(false);
  });

  it("round-trips all prefs", () => {
    persistUiPrefs({
      soundOnComplete: false,
      analyticsEnabled: false,
      focusMode: true,
      sidebarWidthPx: 320,
      chatWidthPx: 480,
    });
    expect(loadUiPrefs()).toEqual({
      soundOnComplete: false,
      analyticsEnabled: false,
      focusMode: true,
      sidebarWidthPx: 320,
      chatWidthPx: 480,
    });
  });

  it("fills defaults for payloads written before a field existed", () => {
    localStorage.setItem("compose.uiPrefs.v1", JSON.stringify({ soundOnComplete: false }));
    expect(loadUiPrefs()).toEqual({
      soundOnComplete: false,
      analyticsEnabled: true,
      focusMode: false,
      sidebarWidthPx: null,
      chatWidthPx: null,
    });
  });

  it("falls back wholesale on a corrupt payload", () => {
    localStorage.setItem("compose.uiPrefs.v1", "{not json");
    expect(loadUiPrefs()).toEqual({
      soundOnComplete: true,
      analyticsEnabled: true,
      focusMode: false,
      sidebarWidthPx: null,
      chatWidthPx: null,
    });
  });

  it("rejects nonsense widths (zero, negative, NaN) back to defaults", () => {
    localStorage.setItem(
      "compose.uiPrefs.v1",
      JSON.stringify({ sidebarWidthPx: -5, chatWidthPx: "wide" }),
    );
    const prefs = loadUiPrefs();
    expect(prefs.sidebarWidthPx).toBeNull();
    expect(prefs.chatWidthPx).toBeNull();
  });
});
