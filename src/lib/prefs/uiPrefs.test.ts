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
      zoom: 1.25,
      theme: "dark",
    });
    expect(loadUiPrefs()).toEqual({
      soundOnComplete: false,
      analyticsEnabled: false,
      focusMode: true,
      sidebarWidthPx: 320,
      chatWidthPx: 480,
      zoom: 1.25,
      theme: "dark",
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
      zoom: 1,
      theme: "system",
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
      zoom: 1,
      theme: "system",
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

  it("falls back to following the system for an unusable theme", () => {
    localStorage.setItem("compose.uiPrefs.v1", JSON.stringify({ theme: "solarized" }));
    expect(loadUiPrefs().theme).toBe("system");
  });

  it("clamps a stored zoom instead of trusting it", () => {
    // Everything is sized off the root font size, so a bad scale here is not a
    // cosmetic problem — it is an app nobody can read.
    localStorage.setItem("compose.uiPrefs.v1", JSON.stringify({ zoom: 12 }));
    expect(loadUiPrefs().zoom).toBe(2);

    localStorage.setItem("compose.uiPrefs.v1", JSON.stringify({ zoom: "big" }));
    expect(loadUiPrefs().zoom).toBe(1);
  });
});
