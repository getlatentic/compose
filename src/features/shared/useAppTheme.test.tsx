// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useUiStore } from "../../app/store/uiStore";
import { useAppTheme } from "./useAppTheme";

function Harness() {
  useAppTheme();
  return null;
}

/**
 * The WIRING, which is what actually broke. `applyTheme` had unit tests and the
 * store had unit tests, and both passed while nothing connected them: choosing
 * a theme updated the store, moved the radio and wrote the preference, and the
 * app kept the theme it booted with until the next launch. Testing the halves
 * separately could not see that.
 */
describe("useAppTheme", () => {
  beforeEach(() => {
    document.documentElement.removeAttribute("data-theme");
    useUiStore.getState().setTheme("system");
  });
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-theme");
  });

  it("puts an explicit choice on the document as soon as it changes", () => {
    render(<Harness />);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);

    act(() => useUiStore.getState().setTheme("dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    act(() => useUiStore.getState().setTheme("light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("clears the attribute again when the choice goes back to system", () => {
    render(<Harness />);
    act(() => useUiStore.getState().setTheme("dark"));
    act(() => useUiStore.getState().setTheme("system"));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("applies the stored choice on mount, not only on later changes", () => {
    useUiStore.getState().setTheme("dark");
    render(<Harness />);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});

/**
 * A hook nothing calls is a hook that does nothing, which is precisely how the
 * theme shipped inert: `applyTheme` worked, the store worked, and the root
 * never mounted the effect that joins them. Rendering `App` here would mean
 * mocking the whole router and IPC layer for one line of wiring, so this reads
 * the root instead — a guard on the wiring, not a behaviour test.
 */
describe("the app root wires appearance", () => {
  // Repo-relative: vitest runs from the project root.
  const source = readFileSync("src/app/App.tsx", "utf8");

  it.each(["useAppTheme", "useAppZoom"])("calls %s", (hook) => {
    expect(source).toContain(`${hook}()`);
  });
});
