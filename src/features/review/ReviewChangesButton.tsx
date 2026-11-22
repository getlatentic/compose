import { useCallback, useSyncExternalStore } from "react";
import { EditorView } from "@codemirror/view";

import { editDomId } from "./reviewDecorations";
import { reviewBridge } from "./reviewBridge";

/**
 * "Review 2 changes": the one primary action while a run's changes wait.
 * Each press moves to the next change after the caret, wrapping round, and
 * puts focus on its card so the keyboard can decide it.
 */
export function ReviewChangesButton() {
  const snapshot = useSyncExternalStore(reviewBridge.subscribe, reviewBridge.getSnapshot);
  const { view, edits } = snapshot;

  const handleClick = useCallback(() => {
    if (!view || edits.length === 0) return;
    const caret = view.state.selection.main.head;
    const next = edits.find((edit) => edit.from > caret) ?? edits[0];
    view.dispatch({
      selection: { anchor: next.from },
      effects: EditorView.scrollIntoView(next.from, { y: "center" }),
    });
    // After the scroll has laid the card out.
    requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(`[data-review-id="${editDomId(next)}"]`);
      card?.querySelector<HTMLButtonElement>("button")?.focus();
    });
  }, [view, edits]);

  if (edits.length === 0) return null;
  return (
    <button type="button" className="review-changes-button" onClick={handleClick}>
      Review {edits.length} change{edits.length === 1 ? "" : "s"}
    </button>
  );
}
