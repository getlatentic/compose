// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { hasVibrancy, trackWindowFocus } from "./windowChrome";

afterEach(() => document.documentElement.removeAttribute("data-window"));

describe("hasVibrancy", () => {
  it("is true only inside Compose on a Mac", () => {
    expect(hasVibrancy({ navigator: { platform: "MacIntel" }, __TAURI_INTERNALS__: {} })).toBe(true);
    expect(hasVibrancy({ navigator: { platform: "MacIntel" } })).toBe(false);
    expect(hasVibrancy({ navigator: { platform: "Win32" }, __TAURI_INTERNALS__: {} })).toBe(false);
  });
});

describe("trackWindowFocus", () => {
  it("follows the window going behind and coming back, until stopped", () => {
    const root = document.documentElement;
    const stop = trackWindowFocus(root);
    window.dispatchEvent(new Event("blur"));
    expect(root.getAttribute("data-window")).toBe("inactive");
    window.dispatchEvent(new Event("focus"));
    expect(root.getAttribute("data-window")).toBe("active");
    stop();
    window.dispatchEvent(new Event("blur"));
    expect(root.getAttribute("data-window")).toBe("active");
  });
});
