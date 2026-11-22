import { Prec, StateEffect, StateField, type ChangeDesc } from "@codemirror/state";
import { EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { MarkdownExtension } from "@latentic/live-markdown";

import { allLiveBlocks, blockId, type LiveBlock } from "./liveBlocks";
import { locateComment } from "./locateComment";
import { reviewBridge, type LiveComment } from "./reviewBridge";
import { buildReviewDecorations } from "./reviewDecorations";

/** Free width the scroller needs beside the note column for the margin: its
 *  own padding (2 × 48), the gap with the leader, the card, an edge. */
const ROOM_FOR_MARGIN_PX = 96 + 56 + 264 + 32;
/** Recompute blocks this long after the last edit, not on every keystroke. */
const RECOMPUTE_DELAY_MS = 250;

interface ReviewState {
  readonly blocks: readonly LiveBlock[];
  readonly comments: readonly LiveComment[];
  readonly folded: boolean;
  readonly decorations: DecorationSet;
}

const setReview = StateEffect.define<{ blocks: readonly LiveBlock[]; comments: readonly LiveComment[] }>();
const setFolded = StateEffect.define<boolean>();

function mapBlock(block: LiveBlock, changes: ChangeDesc): LiveBlock {
  const from = changes.mapPos(block.from, 1);
  return { ...block, from, to: Math.max(from, changes.mapPos(block.to, -1)) };
}

const reviewField = StateField.define<ReviewState>({
  create: (state) => ({ blocks: [], comments: [], folded: false, decorations: buildReviewDecorations(state, [], false) }),
  update(value, tr) {
    if (!tr.docChanged && tr.effects.length === 0) {
      return value;
    }
    let { blocks, comments, folded } = value;
    let rebuild = false;
    if (tr.docChanged) {
      blocks = blocks.map((block) => mapBlock(block, tr.changes));
      comments = comments.map((comment) => ({ ...comment, from: tr.changes.mapPos(comment.from, 1) }));
    }
    for (const effect of tr.effects) {
      if (effect.is(setReview)) {
        ({ blocks, comments } = effect.value);
        rebuild = true;
      } else if (effect.is(setFolded) && effect.value !== folded) {
        folded = effect.value;
        rebuild = true;
      }
    }
    const decorations = rebuild
      ? buildReviewDecorations(tr.state, blocks, folded)
      : value.decorations.map(tr.changes);
    return { blocks, comments, folded, decorations };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (state) => state.decorations),
    EditorView.editorAttributes.from(field, (state): Record<string, string> =>
      (state.blocks.length > 0 || state.comments.length > 0) && !state.folded ? { class: "cm-review-wide" } : {},
    ),
  ],
});

function computeReview(view: EditorView): { blocks: LiveBlock[]; comments: LiveComment[] } {
  const note = view.state.doc.toString();
  const blocks = allLiveBlocks(reviewBridge.reviews, note);
  const comments = reviewBridge.comments
    .map((comment) => locateComment(note, comment))
    .filter((comment): comment is LiveComment => comment !== null);
  return { blocks, comments };
}

/**
 * Keeps the field in step with the review data, decides whether there is
 * room for the margin, and reports where each card's line is.
 */
const reviewPlugin = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private readonly host: HTMLElement;

    constructor(private readonly view: EditorView) {
      this.host = document.createElement("div");
      this.host.className = "cm-review-margin";
      // The margin's buttons are not the editor's: a press there must not
      // move the caret or start a selection.
      this.host.addEventListener("mousedown", (event) => event.stopPropagation());
      view.scrollDOM.appendChild(this.host);
      reviewBridge.publish({ view, marginHost: this.host });
      reviewBridge.onInputs(() => this.recomputeSoon(0));
      this.recomputeSoon(0);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) this.recomputeSoon(RECOMPUTE_DELAY_MS);
      const before = update.startState.field(reviewField);
      const after = update.state.field(reviewField);
      if (update.docChanged || update.geometryChanged || update.viewportChanged || before !== after) {
        this.measure();
      }
    }

    private recomputeSoon(delay: number) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.view.dispatch({ effects: setReview.of(computeReview(this.view)) });
      }, delay);
    }

    private measure() {
      this.view.requestMeasure({
        key: this,
        read: (view) => {
          const state = view.state.field(reviewField);
          const scroller = view.scrollDOM.getBoundingClientRect();
          const toScroller = (y: number) => y - scroller.top + view.scrollDOM.scrollTop;
          const tops = new Map<string, number>();
          for (const block of state.blocks) tops.set(blockId(block), toScroller(view.lineBlockAt(block.from).top + view.documentTop));
          for (const comment of state.comments) tops.set(comment.id, toScroller(view.lineBlockAt(comment.from).top + view.documentTop));
          const content = view.contentDOM.getBoundingClientRect();
          return {
            state,
            tops,
            contentRight: content.right - scroller.left + view.scrollDOM.scrollLeft,
            wide: view.scrollDOM.clientWidth - content.width >= ROOM_FOR_MARGIN_PX,
          };
        },
        write: ({ state, tops, contentRight, wide }, view) => {
          reviewBridge.publish({ blocks: state.blocks, comments: state.comments, folded: state.folded, geometry: { tops, contentRight } });
          if (state.folded === wide && state.blocks.length + state.comments.length > 0) {
            // Not inside the measure cycle: a dispatch here would re-enter it.
            queueMicrotask(() => view.dispatch({ effects: setFolded.of(!wide) }));
          }
        },
      });
    }

    destroy() {
      if (this.timer) clearTimeout(this.timer);
      reviewBridge.onInputs(null);
      this.host.remove();
      reviewBridge.reset();
    }
  },
);

const reviewTheme = EditorView.theme({
  // With the margin showing, the note keeps to the left so the cards have room.
  "&.cm-review-wide .cm-content": {
    marginLeft: "0",
    marginRight: "auto",
  },
  ".cm-review-in": {
    color: "var(--color-ai-text)",
    textDecoration: "underline",
    textDecorationColor: "var(--color-ai-leader)",
    textUnderlineOffset: "0.2em",
  },
  ".cm-review-out": {
    color: "var(--color-danger-text)",
    textDecoration: "line-through",
  },
  ".cm-review-other--replaced": {
    marginInlineEnd: "0.3em",
  },
  // A previewed paragraph sits where a line would, with a line's padding.
  ".cm-review-other--block": {
    whiteSpace: "pre-wrap",
    padding: "0 2px 0 6px",
  },
  ".cm-review-slot:empty": {
    display: "none",
  },
});

/** The note's review margin: AI changes and comments beside the lines they touch. */
export const reviewMargin: MarkdownExtension = {
  name: "compose-review-margin",
  version: "1.0.0",
  description: "Shows each agent change and comment beside its line, to keep or undo in place.",
  extensions: [reviewField, reviewPlugin, Prec.highest(reviewTheme)],
};

/** The undecided blocks as the editor has them now, positions current. */
export function currentBlocks(view: EditorView): readonly LiveBlock[] {
  return view.state.field(reviewField, false)?.blocks ?? [];
}
