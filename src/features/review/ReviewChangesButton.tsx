import { useCallback, useSyncExternalStore } from "react";
import { EditorView } from "@codemirror/view";

import { blockId } from "./liveBlocks";
import { reviewBridge } from "./reviewBridge";

/**
 * "Review 2 changes": the one primary action while a run's changes wait.
 * Each press moves to the next change after the caret, wrapping round, and
 * puts focus on its card so the keyboard can decide it.
 */
export function ReviewChangesButton() {
  const snapshot = useSyncExternalStore(reviewBridge.subscribe, reviewBridge.getSnapshot);
  const { view, blocks } = snapshot;

  const handleClick = useCallback(() => {
    if (!view || blocks.length === 0) return;
    const caret = view.state.selection.main.head;
    const next = blocks.find((block) => block.from > caret) ?? blocks[0];
    view.dispatch({
      selection: { anchor: next.from },
      effects: EditorView.scrollIntoView(next.from, { y: "center" }),
    });
    // After the scroll has laid the card out.
    requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(`[data-review-id="${CSS.escape(blockId(next))}"]`);
      card?.querySelector<HTMLButtonElement>("button")?.focus();
    });
  }, [view, blocks]);

  if (blocks.length === 0) return null;
  return (
    <button type="button" className="review-changes-button" onClick={handleClick}>
      Review {blocks.length} change{blocks.length === 1 ? "" : "s"}
    </button>
  );
}
