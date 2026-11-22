import type { EditorView } from "@codemirror/view";

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

/**
 * The one channel between the editor extension (which owns positions and
 * layout) and React (which owns the review data and draws the cards).
 *
 * React → editor: {@link setInputs}. Editor → React: {@link publish}, read
 * through `useSyncExternalStore`. The main window has one note editor, so
 * one bridge.
 */
export class ReviewBridge {
  private snapshot: ReviewSnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private inputListener: (() => void) | null = null;
  reviews: readonly FileReview[] = [];
  comments: readonly MarginComment[] = [];

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ReviewSnapshot => this.snapshot;

  setInputs(reviews: readonly FileReview[], comments: readonly MarginComment[]): void {
    this.reviews = reviews;
    this.comments = comments;
    this.inputListener?.();
  }

  /** The extension listens for new inputs; one editor at a time. */
  onInputs(listener: (() => void) | null): void {
    this.inputListener = listener;
  }

  publish(next: Partial<ReviewSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener();
  }

  reset(): void {
    this.snapshot = EMPTY;
    for (const listener of this.listeners) listener();
  }
}

export const reviewBridge = new ReviewBridge();
