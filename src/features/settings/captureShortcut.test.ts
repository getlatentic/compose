import { describe, expect, it } from "vitest";

import { shortcutFromKeyPress, shortcutLabel } from "./captureShortcut";

const none = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

describe("a quick-capture shortcut from a key press", () => {
  it("names modifiers the way the system registers them, in macOS order", () => {
    expect(shortcutFromKeyPress({ ...none, code: "KeyN", altKey: true, ctrlKey: true })).toBe("Control+Alt+KeyN");
    expect(shortcutFromKeyPress({ ...none, code: "Space", metaKey: true, shiftKey: true })).toBe("Shift+Super+Space");
  });

  it("needs ⌘, ⌃ or ⌥, so it cannot take over ordinary typing", () => {
    expect(shortcutFromKeyPress({ ...none, code: "KeyN" })).toBeNull();
    expect(shortcutFromKeyPress({ ...none, code: "KeyN", shiftKey: true })).toBeNull();
  });

  it("ignores keys that already mean something everywhere", () => {
    expect(shortcutFromKeyPress({ ...none, code: "Escape", metaKey: true })).toBeNull();
    expect(shortcutFromKeyPress({ ...none, code: "Tab", ctrlKey: true })).toBeNull();
    expect(shortcutFromKeyPress({ ...none, code: "ShiftLeft", ctrlKey: true })).toBeNull();
  });
});

describe("a shortcut's label", () => {
  it("is written as macOS menus write it", () => {
    expect(shortcutLabel("Control+Alt+KeyN")).toBe("⌃⌥N");
    expect(shortcutLabel("Shift+Super+Space")).toBe("⇧⌘Space");
    expect(shortcutLabel("Super+Alt+Digit1")).toBe("⌥⌘1");
    expect(shortcutLabel("Control+Period")).toBe("⌃.");
  });
});
