import type { EditorState, Range } from "@codemirror/state";
import { Decoration, WidgetType, type DecorationSet } from "@codemirror/view";

import { blockId, type LiveBlock } from "./liveBlocks";
import { reviewBridge } from "./reviewBridge";
import { wordDiff } from "./wordDiff";

/** Classes for text a change put in the note, and text it took out. */
const IN = "cm-review-in";
const OUT = "cm-review-out";

const inMark = Decoration.mark({ class: IN });
const outMark = Decoration.mark({ class: OUT });

/** The other side of a change, drawn in place but not part of the note. */
class OtherSideWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly className: string,
    private readonly asBlock: boolean,
  ) {
    super();
  }

  eq(other: OtherSideWidget): boolean {
    return other.text === this.text && other.className === this.className && other.asBlock === this.asBlock;
  }

  toDOM(): HTMLElement {
    const element = document.createElement(this.asBlock ? "div" : "span");
    element.className = `${this.className} cm-review-other${this.asBlock ? " cm-review-other--block" : ""}`;
    element.textContent = this.text;
    element.setAttribute("aria-hidden", "true");
    return element;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Folded mode: an empty element under the block's paragraph. React renders
 * the block's card into it through the bridge.
 */
class CardSlotWidget extends WidgetType {
  constructor(private readonly id: string) {
    super();
  }

  eq(other: CardSlotWidget): boolean {
    return other.id === this.id;
  }

  toDOM(): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "cm-review-slot";
    const slots = new Map(reviewBridge.getSnapshot().slots);
    slots.set(this.id, slot);
    reviewBridge.publish({ slots });
    return slot;
  }

  destroy(dom: HTMLElement): void {
    const current = reviewBridge.getSnapshot().slots;
    if (current.get(this.id) === dom) {
      const slots = new Map(current);
      slots.delete(this.id);
      reviewBridge.publish({ slots });
    }
  }

  // The card's buttons handle their own clicks; the editor must not move the
  // caret or start a selection under them.
  ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Marks for one line pair: the words both sides share stay plain, the words
 * in the note are marked, and the other side's words appear as widgets.
 */
function wordMarks(at: number, lineInNote: string, otherLine: string, mode: LiveBlock["mode"], out: Range<Decoration>[]): void {
  // `wordDiff(before, after)`: an applied note holds `after`, a pending one `before`.
  const segments = mode === "applied" ? wordDiff(otherLine, lineInNote) : wordDiff(lineInNote, otherLine);
  const inNote = mode === "applied" ? "added" : "removed";
  const noteMark = mode === "applied" ? inMark : outMark;
  const otherClass = mode === "applied" ? OUT : IN;
  let position = at;
  for (const segment of segments) {
    if (segment.kind === "same") {
      position += segment.text.length;
    } else if (segment.kind === inNote) {
      if (segment.text.trim()) out.push(noteMark.range(position, position + segment.text.length));
      position += segment.text.length;
    } else if (segment.text.trim()) {
      out.push(Decoration.widget({ widget: new OtherSideWidget(segment.text, otherClass, false), side: -1 }).range(position));
    }
  }
}

function blockMarks(block: LiveBlock, note: string, out: Range<Decoration>[]): void {
  const other = block.mode === "applied" ? block.removed : block.added;
  const noteLines = block.from === block.to ? [] : note.slice(block.from, block.to).split("\n");
  const otherLines = other === "" ? [] : other.split("\n");
  if (noteLines.length > 0 && noteLines.length === otherLines.length) {
    let at = block.from;
    noteLines.forEach((line, index) => {
      wordMarks(at, line, otherLines[index], block.mode, out);
      at += line.length + 1;
    });
    return;
  }
  const noteMark = block.mode === "applied" ? inMark : outMark;
  let at = block.from;
  for (const line of noteLines) {
    if (line.trim()) out.push(noteMark.range(at, at + line.length));
    at += line.length + 1;
  }
  if (otherLines.some((line) => line.trim())) {
    const otherClass = block.mode === "applied" ? OUT : IN;
    const text = otherLines.filter((line) => line.trim()).join("\n");
    out.push(Decoration.widget({ widget: new OtherSideWidget(text, otherClass, true), block: true, side: -1 }).range(block.from));
  }
}

export function buildReviewDecorations(state: EditorState, blocks: readonly LiveBlock[], folded: boolean): DecorationSet {
  const note = state.doc.toString();
  const ranges: Range<Decoration>[] = [];
  for (const block of blocks) {
    blockMarks(block, note, ranges);
    if (folded) {
      const end = state.doc.lineAt(Math.min(block.to, note.length)).to;
      ranges.push(Decoration.widget({ widget: new CardSlotWidget(blockId(block)), block: true, side: 1 }).range(end));
    }
  }
  return Decoration.set(ranges, true);
}
