import { type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/**
 * Markdown separates a heading from its paragraph with a blank line, and the
 * editor draws that line at full height: under a title it reads as a hole.
 * A blank line straight after a heading is drawn shorter. The text is
 * unchanged; only its line's height is.
 */

const ATX_HEADING = /^ {0,3}#{1,6}(\s|$)/;

const afterHeading = Decoration.line({ class: "cm-after-heading" });

export function headingGapDecorations(view: EditorView): DecorationSet {
  const { doc } = view.state;
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    let line = doc.lineAt(from);
    while (true) {
      if (line.length === 0 && line.number > 1 && ATX_HEADING.test(doc.line(line.number - 1).text)) {
        ranges.push(afterHeading.range(line.from));
      }
      if (line.to >= to || line.number === doc.lines) break;
      line = doc.line(line.number + 1);
    }
  }
  return Decoration.set(ranges);
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = headingGapDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = headingGapDecorations(update.view);
    }
  },
  { decorations: (value) => value.decorations },
);

const theme = EditorView.theme({
  ".cm-line.cm-after-heading": {
    lineHeight: "0.75em",
  },
});

export const headingGap = [plugin, theme];
