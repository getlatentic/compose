// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useUiStore } from "../../app/store/uiStore";
import { AppearanceSection } from "./AppearanceSection";

/**
 * The visible half of app zoom. The View menu carries the shortcuts, but the
 * person who needs larger text is the least likely to find a menu-bar item, so
 * this control has to state the current size and be reachable without one.
 */
describe("AppearanceSection", () => {
  beforeEach(() => {
    useUiStore.getState().setZoom(1);
    localStorage.clear();
  });
  afterEach(cleanup);

  it("shows the current size as a percentage", () => {
    useUiStore.getState().setZoom(1.25);
    render(<AppearanceSection />);
    expect(screen.getByText("125%")).toBeTruthy();
  });

  it("steps up and down through the stops", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    expect(screen.getByText("100%")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /larger text/i }));
    expect(screen.getByText("110%")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /smaller text/i }));
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("returns to 100% on Reset", async () => {
    const user = userEvent.setup();
    useUiStore.getState().setZoom(1.75);
    render(<AppearanceSection />);

    await user.click(screen.getByRole("button", { name: /reset/i }));
    expect(screen.getByText("100%")).toBeTruthy();
  });

  it("disables Reset when nothing is to reset", () => {
    render(<AppearanceSection />);
    expect(screen.getByRole("button", { name: /reset/i }).hasAttribute("disabled")).toBe(true);
  });

  it("stops offering to grow past the largest size", async () => {
    const user = userEvent.setup();
    render(<AppearanceSection />);
    const larger = screen.getByRole("button", { name: /larger text/i });

    // Press well past the number of stops; the control must clamp, not run away.
    for (let i = 0; i < 12; i += 1) {
      if (larger.hasAttribute("disabled")) {
        break;
      }
      await user.click(larger);
    }
    expect(screen.getByText("200%")).toBeTruthy();
    expect(larger.hasAttribute("disabled")).toBe(true);
  });

  it("announces the size so a change is not silent to a screen reader", () => {
    render(<AppearanceSection />);
    const value = screen.getByText("100%");
    expect(value.getAttribute("aria-live")).toBe("polite");
  });
});
