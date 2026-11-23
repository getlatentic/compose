import { DEFAULT_PALETTE, PALETTES, type Palette, type PaletteColors, type PaletteFonts } from "./palettes";

/**
 * Builds the stylesheet that defines every palette's custom properties, and
 * puts it in the document before the first paint.
 *
 * Built from `palettes.json` at start-up rather than written out as SCSS, so
 * the JSON stays the only copy of the values.
 *
 * The selectors match any element, not only the root. A Settings swatch sets
 * `data-palette` on its own preview and so draws in that palette while the
 * window around it keeps the chosen one. Dark follows the same three states as
 * `_tokens.scss`: the system, unless `data-theme` says otherwise.
 */

const STYLE_ID = "compose-palettes";

/** Font family as Figma names it → the stack defined in `_reading.scss`. */
const FONT_STACKS: Readonly<Record<string, string>> = {
  "IBM Plex Sans": "var(--font-plex-sans)",
  "IBM Plex Serif": "var(--font-plex-serif)",
  "JetBrains Mono": "var(--font-jetbrains-mono)",
  "Chalkboard SE": "var(--font-chalkboard)",
  System: "var(--font-system)",
  "System Mono": "var(--font-system-mono)",
};

export function fontStack(family: string): string {
  const stack = FONT_STACKS[family];
  if (!stack) {
    throw new Error(`No font stack for "${family}"`);
  }
  return stack;
}

/** `"sidebar/text"` → `--color-sidebar-text`. */
export function colorProperty(token: string): string {
  return `--color-${token.replace(/\//g, "-")}`;
}

function colorDeclarations(colors: PaletteColors): string[] {
  return Object.entries(colors).map(([token, value]) => `${colorProperty(token)}: ${value};`);
}

function fontDeclarations(fonts: PaletteFonts): string[] {
  return [
    `--font-ui: ${fontStack(fonts.ui)};`,
    `--font-doc-body: ${fontStack(fonts.docBody)};`,
    `--font-doc-heading: ${fontStack(fonts.docHeading)};`,
    `--font-doc-heading-weight: ${fonts.docHeadingWeight};`,
    `--font-doc-code: ${fontStack(fonts.docCode)};`,
  ];
}

/**
 * Hover, pressed and hairline colours. Tints of the text colour read the same
 * on every surface they land on (the note, a card, the chat), the way macOS
 * draws them; Classic keeps its original flat greys.
 */
export function stateDeclarations(palette: Palette): string[] {
  if (palette.solidStates) {
    return [
      "--state-hover: var(--color-surface-hover);",
      "--state-pressed: var(--color-surface-pressed);",
      "--color-edge: var(--color-border-default);",
    ];
  }
  const tint = (percent: number) => `color-mix(in srgb, var(--color-text-primary) ${percent}%, transparent)`;
  return [`--state-hover: ${tint(6)};`, `--state-pressed: ${tint(10)};`, `--color-edge: ${tint(8)};`];
}

function rule(selectors: string[], declarations: string[]): string {
  return `${selectors.join(",\n")} {\n  ${declarations.join("\n  ")}\n}`;
}

const FOLLOW_SYSTEM = ':root:not([data-theme="light"])';
const FORCED_DARK = ':root[data-theme="dark"]';

/**
 * `selector` once the root matches `root`. A `:root…` selector is the root
 * itself; any other matches the root or an element inside it.
 */
function underRoot(root: string, selector: string): string[] {
  return selector.startsWith(":root")
    ? [`${root}${selector.slice(":root".length)}`]
    : [`${root}${selector}`, `${root} ${selector}`];
}

/**
 * Light declarations on `selectors`, and dark ones on the same selectors once
 * the appearance is dark: by the system unless `data-theme="light"`, or by an
 * explicit `data-theme="dark"`.
 */
function themedRules(selectors: string[], light: string[], dark: string[]): string {
  const darkWhen = (root: string) => selectors.flatMap((selector) => underRoot(root, selector));
  return [
    rule(selectors, light),
    `@media (prefers-color-scheme: dark) {\n${rule(darkWhen(FOLLOW_SYSTEM), dark)}\n}`,
    rule(darkWhen(FORCED_DARK), dark),
  ].join("\n");
}

function paletteRules(palette: Palette): string {
  return [
    themedRules(
      [`[data-palette="${palette.id}"]`],
      [...colorDeclarations(palette.light), ...fontDeclarations(palette.fonts), ...stateDeclarations(palette)],
      colorDeclarations(palette.dark),
    ),
    editorSchemeRules(palette),
  ].join("\n");
}

/** The note panels: the editor and the Settings preview of it. Kept equal to `$editor-panels` in `_appearance-mixins.scss`. */
export const EDITOR_PANELS = [".editor-region", ".editor-preview"];

/**
 * The editor's own light or dark (`data-editor-scheme`), whatever the app's:
 * the note panel takes the palette's light or dark half; "app" sets no
 * attribute and the panel follows the window. The scheme sits in `:where` so
 * these rules outrank the base dark tokens (`_tokens.scss`) by the palette
 * attribute alone, and the writer's own background colour
 * (`_note-background.scss`) still outranks them. The hover and edge tints
 * are declared again here because they mix the panel's own text colour.
 */
function editorSchemeRules(palette: Palette): string {
  const under = (scheme: "light" | "dark") =>
    EDITOR_PANELS.map((panel) => `:root:where([data-editor-scheme="${scheme}"])[data-palette="${palette.id}"] ${panel}`);
  const states = stateDeclarations(palette);
  return [
    rule(under("light"), [...colorDeclarations(palette.light), ...states, "color-scheme: light;"]),
    rule(under("dark"), [...colorDeclarations(palette.dark), ...states, "color-scheme: dark;"]),
  ].join("\n");
}

/**
 * Every palette's rules, after the default palette's state colours on bare
 * `:root`, so a page that never sets `data-palette` still has hovers.
 */
export function paletteCss(palettes: readonly Palette[] = PALETTES, defaultId: string = DEFAULT_PALETTE): string {
  const fallback = palettes.find((palette) => palette.id === defaultId) ?? palettes[0];
  return [rule([":root"], stateDeclarations(fallback)), ...palettes.map(paletteRules)].join("\n");
}

function splashDeclarations(colors: PaletteColors): string[] {
  return [
    `--splash-bg: ${colors["bg/app"]};`,
    `--splash-sidebar: ${colors["sidebar/bg"]};`,
    `--splash-fg: ${colors["text/primary"]};`,
    `--splash-divider: ${colors["border/default"]};`,
  ];
}

/**
 * The launch skeleton's colours, inlined into index.html at build time
 * (vite.config.ts): it paints before any module runs, so it cannot wait for
 * {@link installPaletteStyles}. The default palette sits on bare `:root`, so a
 * missing or unknown `data-palette` still draws it.
 */
export function splashCss(palettes: readonly Palette[] = PALETTES, defaultId: string = DEFAULT_PALETTE): string {
  const fallback = palettes.find((palette) => palette.id === defaultId) ?? palettes[0];
  return [
    themedRules([":root"], splashDeclarations(fallback.light), splashDeclarations(fallback.dark)),
    ...palettes.map((palette) =>
      themedRules(
        [`:root[data-palette="${palette.id}"]`],
        splashDeclarations(palette.light),
        splashDeclarations(palette.dark),
      ),
    ),
  ].join("\n");
}

/** Idempotent: a second call (HMR, a second entry point) replaces nothing. */
export function installPaletteStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) {
    return;
  }
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = paletteCss();
  doc.head.prepend(style);
}
