import { useCallback, useSyncExternalStore } from "react";
import { EditorView } from "@codemirror/view";

import { reviewBridge } from "./reviewBridge";
import { setReviewMode } from "./reviewExtension";

/**
 * The way into review mode, like Track Changes' review: "Review 2 changes"
 * opens the margin and puts the caret on the next change after it, whose
 * card opens level with its words. "Done reviewing" closes the margin and
 * gives the note its width back; the changes stay marked in the text.
 */
export function ReviewChangesButton() {
  const snapshot = useSyncExternalStore(reviewBridge.subscribe, reviewBridge.getSnapshot);
  const { view, edits, reviewing } = snapshot;

  const handleClick = useCallback(() => {
    if (!view || edits.length === 0) return;
    if (reviewing) {
      setReviewMode(view, false);
      return;
    }
    const caret = view.state.selection.main.head;
    const next = edits.find((edit) => edit.from > caret) ?? edits[0];
    setReviewMode(view, true);
    view.dispatch({
      selection: { anchor: next.from },
      effects: EditorView.scrollIntoView(next.from, { y: "center" }),
    });
    view.focus();
  }, [view, edits, reviewing]);

  if (edits.length === 0) return null;
  return (
    <button
      type="button"
      className={`review-changes-button${reviewing ? " review-changes-button--done" : ""}`}
      aria-pressed={reviewing}
      onClick={handleClick}
    >
      {reviewing ? "Done reviewing" : `Review ${edits.length} change${edits.length === 1 ? "" : "s"}`}
    </button>
  );
}
