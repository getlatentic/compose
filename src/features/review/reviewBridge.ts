import type { EditorView } from "@codemirror/view";

import { createValueStore } from "../../lib/valueStore";

import type { FileReview, LiveEdit } from "./liveEdits";

/** An open comment on the note, as the margin shows it. */
export interface MarginComment {
  readonly id: string;
  readonly body: string;
  readonly selectedText: string;
  readonly prefix: string;
  readonly suffix: string;
}

/** A comment found in the note as it is now. */
export interface LiveComment extends MarginComment {
  readonly from: number;
}

/** Where the margin's cards go, read from the editor's layout. */
export interface MarginGeometry {
  /** Top of each card's anchor line, by edit id or comment id, in scroller pixels. */
  readonly tops: ReadonlyMap<string, number>;
  /** Right edge of the note column, in scroller pixels. */
  readonly contentRight: number;
}

export interface ReviewSnapshot {
  readonly view: EditorView | null;
  readonly edits: readonly LiveEdit[];
  readonly comments: readonly LiveComment[];
  /** Review mode is on: every edit has a card and the note has given up the margin's width. */
  readonly reviewing: boolean;
  /** The pane is wide enough for the margin without narrowing the note. */
  readonly roomBeside: boolean;
  /** The edit the caret is in: its card is opened and lined up with its words. */
  readonly caretEditId: string | null;
  readonly geometry: MarginGeometry;
  /** The element inside the scroller that the margin renders into. */
  readonly marginHost: HTMLElement | null;
}

const EMPTY_GEOMETRY: MarginGeometry = { tops: new Map(), contentRight: 0 };

const EMPTY: ReviewSnapshot = {
  view: null,
  edits: [],
  comments: [],
  reviewing: false,
  roomBeside: false,
  caretEditId: null,
  geometry: EMPTY_GEOMETRY,
  marginHost: null,
};

export interface ReviewInputs {
  readonly reviews: readonly FileReview[];
  readonly comments: readonly MarginComment[];
}

const NO_INPUTS: ReviewInputs = { reviews: [], comments: [] };

/*
 * The two channels between the editor extension (which owns positions and
 * layout) and React (which owns the review data and draws the cards). The
 * main window has one note editor, so one of each.
 */

/** React → editor: the open note's reviews and comments. */
export const reviewInputs = createValueStore<ReviewInputs>(NO_INPUTS);

/** Editor → React: where everything is, for the margin to draw. */
export const reviewSnapshot = createValueStore<ReviewSnapshot>(EMPTY);

export function setReviewInputs(reviews: readonly FileReview[], comments: readonly MarginComment[]): void {
  reviewInputs.set({ reviews, comments });
}

export function publishReview(next: Partial<ReviewSnapshot>): void {
  reviewSnapshot.set({ ...reviewSnapshot.get(), ...next });
}

export function resetReview(): void {
  reviewSnapshot.set(EMPTY);
}
