// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "../../../app/store/uiStore";
import { PALETTES } from "../../../lib/theme/palettes";
import { EditorSettings } from "./EditorSettings";

vi.mock("../../../lib/theme/installedFonts", () => ({
  loadInstalledFamilies: () => Promise.resolve(["Abril Fatface", "Avenir Next", "Baskerville"]),
}));

function group(name: RegExp) {
  return screen.getByRole("radiogroup", { name });
}

function picker(name: RegExp) {
  return screen.getByRole("button", { name });
}

function optionLabels(): string[] {
  return screen.getAllByRole("option").map((option) => option.textContent ?? "");
}

describe("EditorSettings", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView ??= () => undefined;
  });

  beforeEach(() => {
    const store = useUiStore.getState();
    store.setTheme("system");
    store.setPalette("walnut");
    store.resetToTheme();
    store.setReadingSize(18);
    store.setExportFont("note");
    localStorage.clear();
  });
  afterEach(cleanup);

  describe("theme", () => {
    it("shows the current theme on one button and lists every palette with a swatch", async () => {
      const user = userEvent.setup();
      render(<EditorSettings />);
      await user.click(picker(/^theme: walnut$/i));
      expect(optionLabels()).toEqual(PALETTES.map((p) => p.label));
      const swatches = [...document.querySelectorAll('[role="listbox"] .theme-swatch')];
      expect(swatches.map((swatch) => swatch.getAttribute("data-palette"))).toEqual(PALETTES.map((p) => p.id));
      expect(screen.getByRole("option", { name: "Walnut" }).getAttribute("aria-selected")).toBe("true");
    });

    it("records a theme and closes", async () => {
      const user = userEvent.setup();
      render(<EditorSettings />);
      await user.click(picker(/^theme:/i));
      await user.click(screen.getByRole("option", { name: "Paper" }));
      expect(useUiStore.getState().palette).toBe("paper");
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(picker(/^theme: paper$/i)).toBeTruthy();
    });
  });

  describe("appearance", () => {
    it("follows the app unless told otherwise, and records the editor's own light or dark", async () => {
      const user = userEvent.setup();
      render(<EditorSettings />);
      const scheme = group(/^appearance$/i);
      expect((within(scheme).getByRole("radio", { name: "Match app" }) as HTMLInputElement).checked).toBe(true);
      await user.click(within(scheme).getByRole("radio", { name: "Dark" }));
      expect(useUiStore.getState().editorScheme).toBe("dark");
      expect(useUiStore.getState().theme).toBe("system");
    });
  });

  describe("font", () => {
    it("groups Compose's fonts, the Mac's and the installed ones, each written in its own face", async () => {
      const user = userEvent.setup();
      render(<EditorSettings />);
      await user.click(picker(/^font: theme's font$/i));
      const sections = () => within(screen.getByRole("listbox")).getAllByRole("group").map((g) => g.getAttribute("aria-label"));
      await waitFor(() => expect(sections()).toEqual(["Compose", "Mac", "Installed"]));
      const abril = screen.getByRole("option", { name: "Abril Fatface" });
      expect((abril.querySelector(".popup-picker__label") as HTMLElement).style.fontFamily).toContain("Abril Fatface");
    });

    it("records a built-in font, and an installed one by its family", async () => {
      const user = userEvent.setup();
      render(<EditorSettings />);
      await user.click(picker(/^font:/i));
      await user.click(screen.getByRole("option", { name: "New York" }));
      expect(useUiStore.getState().readingFont).toBe("newYork");
      await user.click(picker(/^font: new york$/i));
      await user.click(await screen.findByRole("option", { name: "Baskerville" }));
      expect(useUiStore.getState().readingFont).toBe("custom");
      expect(useUiStore.getState().customFont).toBe("Baskerville");
      expect(picker(/^font: baskerville$/i)).toBeTruthy();
    });

    it("finds a font by search and chooses it with Return", async () => {
      const user = userEvent.setup();
      render(<EditorSettings />);
      await user.click(picker(/^font:/i));
      await screen.findByRole("option", { name: "Avenir Next" });
      await user.type(screen.getByRole("searchbox", { name: "Search fonts" }), "aven");
      expect(optionLabels()).toEqual(["Avenir Next"]);
      await user.keyboard("{Enter}");
      expect(useUiStore.getState().customFont).toBe("Avenir Next");
      expect(screen.queryByRole("listbox")).toBeNull();
    });
  });

  describe("reset", () => {
    it("puts a colour behind the note, and hands font, page and light/dark back to the theme", async () => {
      const user = userEvent.setup();
      render(<EditorSettings />);
      expect(screen.getByRole("button", { name: "Reset to theme" })).toHaveProperty("disabled", true);
      await user.click(within(group(/^background$/i)).getByRole("radio", { name: "Colour" }));
      await user.click(within(group(/^appearance$/i)).getByRole("radio", { name: "Light" }));
      expect(useUiStore.getState().noteBackground).toEqual({ kind: "color", color: "#f4efe6" });
      expect(screen.getByLabelText("Background colour")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Reset to theme" }));
      const state = useUiStore.getState();
      expect(state.noteBackground).toEqual({ kind: "theme" });
      expect(state.readingFont).toBe("theme");
      expect(state.editorScheme).toBe("app");
    });
  });

  describe("type", () => {
    it("steps the text size a pixel at a time, within its bounds, and back to the default", async () => {
      const user = userEvent.setup();
      render(<EditorSettings />);
      expect(screen.getByText("18 px")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Default" })).toHaveProperty("disabled", true);
      await user.click(screen.getByRole("button", { name: "Larger text" }));
      await user.click(screen.getByRole("button", { name: "Larger text" }));
      expect(useUiStore.getState().readingSize).toBe(20);
      expect(screen.getByText("20 px")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Default" }));
      expect(useUiStore.getState().readingSize).toBe(18);
      useUiStore.getState().setReadingSize(12);
      expect(await screen.findByText("12 px")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Smaller text" })).toHaveProperty("disabled", true);
    });

    it("sends exports in the LaTeX look when asked", async () => {
      const user = userEvent.setup();
      render(<EditorSettings />);
      await user.click(within(group(/^exports$/i)).getByRole("radio", { name: "LaTeX" }));
      expect(useUiStore.getState().exportFont).toBe("latex");
    });
  });
});
