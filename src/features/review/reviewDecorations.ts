import type { Range } from "@codemirror/state";
import { Decoration, WidgetType, type DecorationSet } from "@codemirror/view";

import { editId, type LiveEdit } from "./liveEdits";

/** Classes for text an edit put in the note, and text it took out. */
const IN = "cm-review-in";
const OUT = "cm-review-out";
/** Ties an edit's marks to its card, for the hover link between them. */
export const EDIT_ATTRIBUTE = "data-review-edit";

/** An edit's id as a DOM attribute value: safe inside a quoted CSS selector. */
export function editDomId(edit: Pick<LiveEdit, "reviewId" | "key">): string {
  return encodeURIComponent(editId(edit));
}

/** The other side of an edit, drawn in place but not part of the note. */
class OtherSideWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly className: string,
    private readonly asBlock: boolean,
    private readonly domId: string,
  ) {
    super();
  }

  eq(other: OtherSideWidget): boolean {
    return (
      other.text === this.text &&
      other.className === this.className &&
      other.asBlock === this.asBlock &&
      other.domId === this.domId
    );
  }

  toDOM(): HTMLElement {
    const element = document.createElement(this.asBlock ? "div" : "span");
    element.className = `${this.className} cm-review-other${this.asBlock ? " cm-review-other--block" : ""}`;
    element.textContent = this.text;
    element.setAttribute("aria-hidden", "true");
    element.setAttribute(EDIT_ATTRIBUTE, this.domId);
    return element;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * A word edit: its words in the note are marked, and the other side's words
 * are drawn beside them, before the new words (applied) or after the old
 * (pending), so a replacement reads old then new.
 */
function wordMarks(edit: LiveEdit, note: string, out: Range<Decoration>[]): void {
  const applied = edit.mode === "applied";
  const domId = editDomId(edit);
  const inNote = note.slice(edit.from, edit.to);
  if (inNote.trim()) {
    // The space an insertion or deletion carries with it is not marked.
    const from = edit.from + (inNote.length - inNote.trimStart().length);
    const to = edit.to - (inNote.length - inNote.trimEnd().length);
    out.push(Decoration.mark({ class: applied ? IN : OUT, attributes: { [EDIT_ATTRIBUTE]: domId } }).range(from, to));
  }
  const other = edit.replacement.trim();
  if (!other) return;
  // Drawn trimmed; a margin stands in for the space on each side it had,
  // or that keeps a replacement's two sides apart.
  const replacing = inNote.trim() !== "";
  const spaceBefore = /^\s/.test(edit.replacement) || (replacing && !applied);
  const spaceAfter = /\s$/.test(edit.replacement) || (replacing && applied);
  const className = [applied ? OUT : IN, spaceAfter ? "cm-review-other--replaced" : "", spaceBefore ? "cm-review-other--after" : ""]
    .filter(Boolean)
    .join(" ");
  const widget = new OtherSideWidget(other, className, false, domId);
  out.push(Decoration.widget({ widget, side: applied ? -1 : 1 }).range(applied ? edit.from : edit.to));
}

/** A whole-lines edit: its lines in the note are marked, the other side drawn as a block above them. */
function lineMarks(edit: LiveEdit, note: string, out: Range<Decoration>[]): void {
  const applied = edit.mode === "applied";
  const domId = editDomId(edit);
  const mark = Decoration.mark({ class: applied ? IN : OUT, attributes: { [EDIT_ATTRIBUTE]: domId } });
  const noteLines = edit.from === edit.to ? [] : note.slice(edit.from, edit.to).split("\n");
  let at = edit.from;
  for (const line of noteLines) {
    if (line.trim()) out.push(mark.range(at, at + line.length));
    at += line.length + 1;
  }
  const other = (applied ? edit.removed : edit.added)
    .split("\n")
    .filter((line) => line.trim())
    .join("\n");
  if (other) {
    const widget = new OtherSideWidget(other, applied ? OUT : IN, true, domId);
    out.push(Decoration.widget({ widget, block: true, side: -1 }).range(edit.from));
  }
}

export function buildReviewDecorations(note: string, edits: readonly LiveEdit[]): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const edit of edits) {
    if (edit.wholeLines) lineMarks(edit, note, ranges);
    else wordMarks(edit, note, ranges);
  }
  return Decoration.set(ranges, true);
}
