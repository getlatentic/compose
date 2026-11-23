import { describe, expect, it } from "vitest";

import { colorProperty, fontStack, paletteCss, splashCss, stateDeclarations } from "./paletteCss";
import { DEFAULT_PALETTE, PALETTES, normalizePalette, type PaletteColors } from "./palettes";

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** Text token → the backgrounds it is drawn on. Every pair must reach WCAG AA (4.5:1). */
const TEXT_ON: Record<string, string[]> = {
  "text/primary": ["bg/app", "surface/default", "surface/raised", "surface/sunken", "surface/hover", "surface/selected"],
  "text/secondary": ["bg/app", "surface/default", "surface/sunken"],
  "text/tertiary": ["bg/app", "surface/default"],
  "doc/text": ["bg/app", "surface/default"],
  "doc/heading": ["bg/app", "surface/default"],
  "doc/code": ["bg/app", "surface/sunken"],
  "accent/text": ["bg/app", "surface/default", "accent/surface"],
  "text/on-accent": ["accent/default", "accent/hover"],
  "sidebar/text": ["sidebar/bg", "sidebar/hover", "sidebar/active"],
  "sidebar/muted": ["sidebar/bg", "sidebar/active"],
  "ai/text": ["bg/app", "ai/surface"],
  "danger/text": ["bg/app", "danger/surface"],
  "warning/text": ["bg/app", "warning/surface"],
  "success/text": ["bg/app", "success/surface"],
};

function failingPairs(colors: PaletteColors): string[] {
  const failures: string[] = [];
  for (const [text, backgrounds] of Object.entries(TEXT_ON)) {
    for (const background of backgrounds) {
      const ratio = contrast(colors[text], colors[background]);
      if (ratio < 4.5) {
        failures.push(`${text} on ${background}: ${ratio.toFixed(2)}`);
      }
    }
  }
  return failures;
}

describe("palettes", () => {
  it("defines the same tokens, as hex colours, in every palette and appearance", () => {
    const tokens = Object.keys(PALETTES[0].light).sort();
    for (const palette of PALETTES) {
      for (const colors of [palette.light, palette.dark]) {
        expect(Object.keys(colors).sort(), palette.id).toEqual(tokens);
        for (const value of Object.values(colors)) {
          expect(value, palette.id).toMatch(/^#[0-9A-F]{6}$/);
        }
      }
    }
  });

  it.each(PALETTES.flatMap((p) => [[`${p.label} light`, p.light] as const, [`${p.label} dark`, p.dark] as const]))(
    "%s reaches WCAG AA for every text it draws",
    (_name, colors) => {
      expect(failingPairs(colors)).toEqual([]);
    },
  );

  it("catches a pair that falls short", () => {
    const greyOnGrey = { ...PALETTES[0].light, "text/tertiary": "#A0A0A0", "bg/app": "#C0C0C0" };
    expect(failingPairs(greyOnGrey)).toContainEqual(expect.stringMatching(/^text\/tertiary on bg\/app: 1\.\d\d$/));
  });

  it("names only fonts that have a stack", () => {
    for (const { fonts } of PALETTES) {
      for (const family of [fonts.ui, fonts.docBody, fonts.docHeading, fonts.docCode]) {
        expect(() => fontStack(family)).not.toThrow();
      }
    }
  });

  it("keeps a stored palette it knows and replaces one it does not", () => {
    expect(normalizePalette("paper")).toBe("paper");
    expect(normalizePalette("neon")).toBe(DEFAULT_PALETTE);
    expect(normalizePalette(undefined)).toBe(DEFAULT_PALETTE);
  });
});

describe("paletteCss", () => {
  const css = paletteCss();

  it("gives each palette its light values on the element that names it", () => {
    for (const palette of PALETTES) {
      expect(css).toContain(`[data-palette="${palette.id}"] {`);
      expect(css).toContain(`${colorProperty("bg/app")}: ${palette.light["bg/app"]};`);
    }
  });

  it("switches to dark both for the system and for an explicit choice, and never for an explicit light", () => {
    const paper = PALETTES.find((p) => p.id === "paper")!;
    const darkValue = `--color-doc-text: ${paper.dark["doc/text"]};`;
    const followSystem = ':root:not([data-theme="light"])[data-palette="paper"]';
    const forced = ':root[data-theme="dark"][data-palette="paper"]';
    const media = css.indexOf("@media (prefers-color-scheme: dark)", css.indexOf('[data-palette="paper"] {'));
    expect(css.indexOf(followSystem)).toBeGreaterThan(media);
    expect(css).toContain(forced);
    // Twice for the window (system and forced), once for an editor set to Dark.
    expect(css.split(darkValue)).toHaveLength(4);
  });

  it("gives the note panel its palette's own half when the editor's scheme is set apart from the app's", () => {
    const paper = PALETTES.find((p) => p.id === "paper")!;
    const editorDark = ':root:where([data-editor-scheme="dark"])[data-palette="paper"] .editor-region';
    const editorLight = ':root:where([data-editor-scheme="light"])[data-palette="paper"] .editor-preview';
    const darkRule = css.slice(css.indexOf(editorDark));
    const lightRule = css.slice(css.indexOf(editorLight));
    expect(darkRule.slice(0, darkRule.indexOf("}"))).toContain(`--color-doc-text: ${paper.dark["doc/text"]};`);
    expect(lightRule.slice(0, lightRule.indexOf("}"))).toContain(`--color-doc-text: ${paper.light["doc/text"]};`);
    expect(lightRule.slice(0, lightRule.indexOf("}"))).toContain("color-scheme: light;");
  });

  it("draws Classic, the default, in the system font throughout", () => {
    expect(DEFAULT_PALETTE).toBe("classic");
    const classicRule = css.slice(css.indexOf('[data-palette="classic"] {'));
    expect(classicRule).toContain("--font-ui: var(--font-system);");
    expect(classicRule).toContain("--font-doc-body: var(--font-system);");
    expect(classicRule).toContain("--font-doc-code: var(--font-system-mono);");
  });

  it("tints hover, pressed and hairlines from the text colour, except Classic, which keeps its own greys", () => {
    const classic = PALETTES.find((p) => p.id === "classic")!;
    const walnut = PALETTES.find((p) => p.id === "walnut")!;
    expect(stateDeclarations(classic)).toContain("--state-hover: var(--color-surface-hover);");
    expect(stateDeclarations(walnut)).toContain("--state-hover: color-mix(in srgb, var(--color-text-primary) 6%, transparent);");
    const walnutRule = css.slice(css.indexOf('[data-palette="walnut"] {'));
    expect(walnutRule.slice(0, walnutRule.indexOf("}"))).toContain("--color-edge: color-mix(");
  });

  it("gives Paper its own note fonts and leaves its UI in Plex Sans", () => {
    const paperRule = css.slice(css.indexOf('[data-palette="paper"] {'));
    expect(paperRule).toContain("--font-doc-body: var(--font-chalkboard);");
    expect(paperRule).toContain("--font-ui: var(--font-plex-sans);");
  });
});

describe("splashCss", () => {
  const css = splashCss();
  const classic = PALETTES.find((p) => p.id === "classic")!;
  const paper = PALETTES.find((p) => p.id === "paper")!;

  it("draws the default palette on a root with no palette, or one this build does not know", () => {
    expect(css.startsWith(`:root {\n  --splash-bg: ${classic.light["bg/app"]};`)).toBe(true);
  });

  it("gives each palette its own sidebar colour, in light and dark", () => {
    expect(css).toContain(`:root[data-palette="paper"] {\n  --splash-bg: ${paper.light["bg/app"]};\n  --splash-sidebar: ${paper.light["sidebar/bg"]};`);
    expect(css).toContain(`:root[data-theme="dark"][data-palette="paper"] {\n  --splash-bg: ${paper.dark["bg/app"]};`);
  });
});
