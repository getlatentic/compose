// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useUiStore } from "../../../app/store/uiStore";
import { PALETTES } from "../../../lib/theme/palettes";
import { AppearanceSettings } from "./AppearanceSettings";

function group(name: RegExp) {
  return screen.getByRole("radiogroup", { name });
}

function checked(radio: HTMLElement): boolean {
  return (radio as HTMLInputElement).checked;
}

describe("AppearanceSettings", () => {
  beforeEach(() => {
    const store = useUiStore.getState();
    store.setZoom(1);
    store.setTheme("system");
    store.setPalette("walnut");
    store.setReadingFont("theme");
    store.setReadingSize("default");
    localStorage.clear();
  });
  afterEach(cleanup);

  describe("theme", () => {
    it("offers every palette, with the current one chosen", () => {
      render(<AppearanceSettings />);
      const radios = within(group(/^theme$/i)).getAllByRole("radio");
      expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual(PALETTES.map((p) => p.id));
      expect(checked(within(group(/^theme$/i)).getByRole("radio", { name: "Walnut" }))).toBe(true);
    });

    it("records a palette, and draws each swatch in its own palette", async () => {
      const user = userEvent.setup();
      const { container } = render(<AppearanceSettings />);
      await user.click(screen.getByRole("radio", { name: "Paper" }));
      expect(useUiStore.getState().palette).toBe("paper");
      const swatches = [...container.querySelectorAll(".palette-swatch")];
      expect(swatches.map((swatch) => swatch.getAttribute("data-palette"))).toEqual(PALETTES.map((p) => p.id));
    });
  });

  describe("appearance", () => {
    it("offers Match Mac as a choice of its own, not a light/dark toggle", () => {
      // Picking Light has to survive the Mac going dark at sunset.
      render(<AppearanceSettings />);
      const appearance = group(/^appearance$/i);
      for (const name of ["Light", "Dark", "Match Mac"]) {
        expect(within(appearance).getByRole("radio", { name })).toBeTruthy();
      }
      expect(checked(within(appearance).getByRole("radio", { name: "Match Mac" }))).toBe(true);
    });

    it("records an explicit choice", async () => {
      const user = userEvent.setup();
      render(<AppearanceSettings />);
      await user.click(within(group(/^appearance$/i)).getByRole("radio", { name: "Dark" }));
      expect(useUiStore.getState().theme).toBe("dark");
    });
  });

  describe("reading", () => {
    it("starts on the theme's own font and records another", async () => {
      const user = userEvent.setup();
      render(<AppearanceSettings />);
      const fonts = group(/^reading$/i);
      expect(checked(within(fonts).getByRole("radio", { name: /^theme/i }))).toBe(true);
      await user.click(within(fonts).getByRole("radio", { name: /^chalkboard/i }));
      expect(useUiStore.getState().readingFont).toBe("chalkboard");
    });

    it("gives each font card its own font, through the same attribute the editor reads", () => {
      const { container } = render(<AppearanceSettings />);
      const cards = [...container.querySelectorAll(".font-card")];
      expect(cards.map((card) => card.getAttribute("data-reading-font"))).toEqual([
        "theme",
        "serif",
        "sans",
        "mono",
        "chalkboard",
      ]);
    });

    it("records a text size", async () => {
      const user = userEvent.setup();
      render(<AppearanceSettings />);
      await user.click(within(group(/^text size$/i)).getByRole("radio", { name: "Large" }));
      expect(useUiStore.getState().readingSize).toBe("large");
    });
  });

  describe("zoom", () => {
    it("shows the current zoom and steps through the stops", async () => {
      const user = userEvent.setup();
      render(<AppearanceSettings />);
      expect(screen.getByText("100%").getAttribute("aria-live")).toBe("polite");
      await user.click(screen.getByRole("button", { name: /zoom in/i }));
      expect(screen.getByText("110%")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: /zoom out/i }));
      expect(screen.getByText("100%")).toBeTruthy();
    });

    it("returns to 100% on Reset, which is off when there is nothing to reset", async () => {
      const user = userEvent.setup();
      useUiStore.getState().setZoom(1.75);
      render(<AppearanceSettings />);
      await user.click(screen.getByRole("button", { name: /reset/i }));
      expect(screen.getByText("100%")).toBeTruthy();
      expect(screen.getByRole("button", { name: /reset/i }).hasAttribute("disabled")).toBe(true);
    });

    it("stops offering to grow past the largest zoom", async () => {
      const user = userEvent.setup();
      render(<AppearanceSettings />);
      const larger = screen.getByRole("button", { name: /zoom in/i });
      for (let i = 0; i < 12 && !larger.hasAttribute("disabled"); i += 1) {
        await user.click(larger);
      }
      expect(screen.getByText("200%")).toBeTruthy();
      expect(larger.hasAttribute("disabled")).toBe(true);
    });
  });
});
