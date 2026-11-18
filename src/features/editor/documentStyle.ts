import { Prec } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import type { MarkdownExtension } from "@latentic/live-markdown";

/**
 * The note's typography and colours, per part: body text, headings and code
 * each take their own `--reading-*` font and size (`_reading.scss`) and their
 * own `--color-doc-*` colour (the palette).
 *
 * A CodeMirror theme rather than a stylesheet rule, so CodeMirror's line
 * measurement sees the metrics. `Prec.highest` because the editor mounts the
 * host's theme before its own base theme, and the later one wins a tie.
 */
const documentTheme = EditorView.theme({
  ".cm-content": {
    fontFamily: "var(--reading-family-body)",
    fontSize: "var(--reading-size-body)",
    lineHeight: "var(--reading-line-body)",
    color: "var(--color-doc-text)",
    maxWidth: "68ch",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--color-doc-text)",
  },
  ".cm-heading--1, .cm-heading--2, .cm-heading--3, .cm-heading--4, .cm-heading--5, .cm-heading--6": {
    fontFamily: "var(--reading-family-heading)",
    fontWeight: "var(--reading-weight-heading)",
    color: "var(--color-doc-heading)",
  },
  ".cm-heading--1": {
    fontSize: "var(--reading-size-h1)",
    lineHeight: "var(--reading-line-h1)",
    letterSpacing: "-0.02em",
    // The one red rule: under the note's title. Padding, not margin, keeps
    // CodeMirror's click metrics exact.
    borderBottom: "0.125rem solid var(--color-rule)",
    paddingBottom: "0.35em",
    marginBottom: "0",
  },
  ".cm-heading--2": {
    fontSize: "var(--reading-size-h2)",
    lineHeight: "var(--reading-line-h2)",
    letterSpacing: "-0.02em",
  },
  ".cm-heading--3": {
    fontSize: "var(--reading-size-h3)",
    lineHeight: "var(--reading-line-h3)",
    letterSpacing: "-0.01em",
  },
  ".cm-heading--4": {
    fontSize: "var(--reading-size-h4)",
    lineHeight: "var(--reading-line-h4)",
  },
  ".cm-heading--5, .cm-heading--6": {
    fontSize: "var(--reading-size-body)",
    lineHeight: "var(--reading-line-body)",
  },
  ".cm-inline-code": {
    fontFamily: "var(--reading-family-code)",
    color: "var(--color-doc-code)",
    background: "color-mix(in srgb, var(--color-text-primary) 7%, transparent)",
  },
  // Translucent, not the opaque sunken surface: the drawn selection paints
  // below the content and an opaque line background would hide it.
  ".cm-fenced-code": {
    fontFamily: "var(--reading-family-code)",
    fontSize: "var(--reading-size-code)",
    lineHeight: "var(--reading-line-code)",
    color: "var(--color-doc-code)",
    background: "color-mix(in srgb, var(--color-text-primary) 4%, transparent)",
    paddingLeft: "1em",
  },
  ".cm-code-info": {
    fontFamily: "var(--font-ui)",
  },
  ".cm-blockquote": {
    color: "var(--color-text-secondary)",
    borderInlineStartColor: "var(--color-border-strong)",
  },
});

/** Root attributes whose change alters the note's fonts or sizes. */
const STYLE_ATTRIBUTES = ["data-palette", "data-reading-font", "data-reading-size", "data-theme", "style"];

/**
 * CodeMirror measures line heights when content changes, not when a font
 * does. A new palette, reading font or size changes every line's height under
 * it, and clicks would land on the wrong line until something else triggered
 * a measure. So: measure when one of those attributes changes, and again when
 * the new font finishes loading.
 */
const remeasureOnStyleChange = ViewPlugin.fromClass(
  class {
    private readonly observer: MutationObserver;
    private readonly fonts: FontFaceSet | undefined;
    private readonly measure: () => void;

    constructor(view: EditorView) {
      this.measure = () => view.requestMeasure();
      this.observer = new MutationObserver(this.measure);
      this.observer.observe(document.documentElement, { attributes: true, attributeFilter: STYLE_ATTRIBUTES });
      this.fonts = document.fonts;
      this.fonts?.addEventListener("loadingdone", this.measure);
    }

    destroy() {
      this.observer.disconnect();
      this.fonts?.removeEventListener("loadingdone", this.measure);
    }
  },
);

export const documentStyle: MarkdownExtension = {
  name: "compose-document-style",
  version: "1.0.0",
  description: "Per-part note fonts, sizes and colours from the palette and reading settings.",
  extensions: [Prec.highest(documentTheme), remeasureOnStyleChange],
};
