import { Prec, StateEffect, StateField, type ChangeDesc } from "@codemirror/state";
import { EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { MarkdownExtension } from "@latentic/live-markdown";

import { allLiveEdits, editId, type LiveEdit } from "./liveEdits";
import { locateComment } from "./locateComment";
import { reviewBridge, type LiveComment } from "./reviewBridge";
import { buildReviewDecorations } from "./reviewDecorations";

/** Width the note gives up for the margin while it shows: the gap the
 *  leaders cross, a card, and an edge. Kept in step with `_review-margin.scss`. */
export const MARGIN_ROOM_PX = 40 + 264 + 16;
/** Recompute edits this long after the last edit, not on every keystroke. */
const RECOMPUTE_DELAY_MS = 250;

interface ReviewState {
  readonly edits: readonly LiveEdit[];
  readonly comments: readonly LiveComment[];
  readonly decorations: DecorationSet;
}

const setReview = StateEffect.define<{ edits: readonly LiveEdit[]; comments: readonly LiveComment[] }>();

function mapEdit(edit: LiveEdit, changes: ChangeDesc): LiveEdit {
  const from = changes.mapPos(edit.from, 1);
  return { ...edit, from, to: Math.max(from, changes.mapPos(edit.to, -1)) };
}

const reviewField = StateField.define<ReviewState>({
  create: () => ({ edits: [], comments: [], decorations: buildReviewDecorations("", []) }),
  update(value, tr) {
    if (!tr.docChanged && tr.effects.length === 0) {
      return value;
    }
    let { edits, comments } = value;
    let rebuild = false;
    if (tr.docChanged) {
      edits = edits.map((edit) => mapEdit(edit, tr.changes));
      comments = comments.map((comment) => ({ ...comment, from: tr.changes.mapPos(comment.from, 1) }));
    }
    for (const effect of tr.effects) {
      if (effect.is(setReview)) {
        ({ edits, comments } = effect.value);
        rebuild = true;
      }
    }
    const decorations = rebuild
      ? buildReviewDecorations(tr.state.doc.toString(), edits)
      : value.decorations.map(tr.changes);
    return { edits, comments, decorations };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (state) => state.decorations),
    EditorView.editorAttributes.from(field, (state): Record<string, string> =>
      state.edits.length > 0 || state.comments.length > 0 ? { class: "cm-review-wide" } : {},
    ),
  ],
});

function computeReview(view: EditorView): { edits: LiveEdit[]; comments: LiveComment[] } {
  const note = view.state.doc.toString();
  const edits = allLiveEdits(reviewBridge.reviews, note);
  const comments = reviewBridge.comments
    .map((comment) => locateComment(note, comment))
    .filter((comment): comment is LiveComment => comment !== null);
  return { edits, comments };
}

/**
 * Keeps the field in step with the review data and reports where each
 * card's line is.
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
          const lineTop = (pos: number) => toScroller(view.lineBlockAt(pos).top + view.documentTop);
          const tops = new Map<string, number>();
          for (const edit of state.edits) {
            // A paragraph is one line that wraps; a word edit's card goes level
            // with the visual line its words are on.
            const coords = edit.wholeLines ? null : view.coordsAtPos(edit.from, 1);
            tops.set(editId(edit), coords ? toScroller(coords.top) : lineTop(edit.from));
          }
          for (const comment of state.comments) tops.set(comment.id, lineTop(comment.from));
          const content = view.contentDOM.getBoundingClientRect();
          return { state, tops, contentRight: content.right - scroller.left + view.scrollDOM.scrollLeft };
        },
        write: ({ state, tops, contentRight }) => {
          reviewBridge.publish({ edits: state.edits, comments: state.comments, geometry: { tops, contentRight } });
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
  // With the margin showing, the note keeps to the left and gives up the
  // margin's width, so every card fits beside it however narrow the pane.
  "&.cm-review-wide .cm-content": {
    marginLeft: "0",
    marginRight: "auto",
    maxWidth: `min(68ch, calc(100% - ${MARGIN_ROOM_PX}px))`,
    minWidth: "16rem",
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
  ".cm-review-other--after": {
    marginInlineStart: "0.3em",
  },
  // A previewed paragraph sits where a line would, with a line's padding.
  ".cm-review-other--block": {
    whiteSpace: "pre-wrap",
    padding: "0 2px 0 6px",
  },
});

/** The note's review margin: each agent edit and comment beside the line it touches. */
export const reviewMargin: MarkdownExtension = {
  name: "compose-review-margin",
  version: "1.0.0",
  description: "Shows each agent edit and comment beside its line, to keep or undo one at a time.",
  extensions: [reviewField, reviewPlugin, Prec.highest(reviewTheme)],
};

/** The undecided edits as the editor has them now, positions current. */
export function currentEdits(view: EditorView): readonly LiveEdit[] {
  return view.state.field(reviewField, false)?.edits ?? [];
}
