import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { EditorView } from "@codemirror/view";

import { useWorkspaceStore } from "../../app/workspaceStore";
import { editId, type LiveEdit } from "./liveEdits";
import { reviewBridge, type LiveComment, type ReviewSnapshot } from "./reviewBridge";
import { ChangeCard, CommentCard } from "./ReviewCard";
import { EDIT_ATTRIBUTE, editDomId } from "./reviewDecorations";
import { currentEdits } from "./reviewExtension";

/** Gap between the note column and a card; the leader runs across it. */
const GAP_PX = 40;
const CARD_GAP_PX = 8;
/** Where on a card its leader arrives: level with the card's first line. */
const LEADER_Y_PX = 15;

type MarginItem =
  | { kind: "change"; id: string; top: number; edit: LiveEdit }
  | { kind: "comment"; id: string; top: number; comment: LiveComment };

function marginItems(snapshot: ReviewSnapshot): MarginItem[] {
  const { tops } = snapshot.geometry;
  const items: MarginItem[] = [];
  for (const edit of snapshot.edits) {
    const top = tops.get(editId(edit));
    if (top !== undefined) items.push({ kind: "change", id: editId(edit), top, edit });
  }
  for (const comment of snapshot.comments) {
    const top = tops.get(comment.id);
    if (top !== undefined) items.push({ kind: "comment", id: comment.id, top, comment });
  }
  return items.sort((a, b) => a.top - b.top);
}

/** The editor's latest positions for the edit, so a swap lands on the text as it is now. */
function freshEdit(view: EditorView, edit: LiveEdit): LiveEdit | null {
  return currentEdits(view).find((candidate) => editId(candidate) === editId(edit)) ?? null;
}

function useDecide(view: EditorView | null) {
  const decideReviewBlock = useWorkspaceStore((state) => state.decideReviewBlock);
  return useCallback(
    (edit: LiveEdit, takeOtherSide: boolean, kept: boolean) => {
      const current = view ? freshEdit(view, edit) : null;
      if (!view || !current) return;
      if (takeOtherSide) {
        view.dispatch({
          changes: { from: current.from, to: current.to, insert: current.replacement },
          userEvent: "input.review",
          scrollIntoView: false,
        });
      }
      decideReviewBlock(current.reviewId, current.key, kept);
    },
    [view, decideReviewBlock],
  );
}

/**
 * The edit under the pointer, from either side: its card, or its words in
 * the note. Both light up together so the reader sees which is which.
 */
function useHoveredEdit(view: EditorView | null): [string | null, (domId: string | null) => void] {
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    if (!view) return;
    const content = view.contentDOM;
    const onOver = (event: Event) => {
      const target = (event.target as Element | null)?.closest(`[${EDIT_ATTRIBUTE}]`);
      setHovered(target?.getAttribute(EDIT_ATTRIBUTE) ?? null);
    };
    const onLeave = () => setHovered(null);
    content.addEventListener("mouseover", onOver);
    content.addEventListener("mouseleave", onLeave);
    return () => {
      content.removeEventListener("mouseover", onOver);
      content.removeEventListener("mouseleave", onLeave);
    };
  }, [view]);
  return [hovered, setHovered];
}

/** Stacks the cards level with their lines, pushed down where they would overlap, and draws the leaders. */
function useCardLayout(items: readonly MarginItem[], contentRight: number) {
  const cards = useRef(new Map<string, HTMLElement>());
  const [leaders, setLeaders] = useState<string[]>([]);
  const left = contentRight + GAP_PX;
  useLayoutEffect(() => {
    let floor = -Infinity;
    const paths: string[] = [];
    for (const item of items) {
      const card = cards.current.get(item.id);
      if (!card) continue;
      const top = Math.max(item.top, floor);
      card.style.top = `${top}px`;
      card.style.left = `${left}px`;
      floor = top + card.offsetHeight + CARD_GAP_PX;
      paths.push(`M${contentRight + 8} ${item.top + LEADER_Y_PX} H${left - 12} L${left} ${top + LEADER_Y_PX}`);
    }
    setLeaders((previous) => (previous.join() === paths.join() ? previous : paths));
  }, [items, left, contentRight]);
  const register = useCallback(
    (id: string) => (element: HTMLElement | null) => {
      if (element) cards.current.set(id, element);
      else cards.current.delete(id);
    },
    [],
  );
  return { leaders, register };
}

/**
 * A card per agent edit and per comment beside the note, each level with
 * its line and tied back to it by a hairline leader.
 */
function Margin({ snapshot, agentName }: { snapshot: ReviewSnapshot; agentName: string }) {
  const items = useMemo(() => marginItems(snapshot), [snapshot]);
  const { leaders, register } = useCardLayout(items, snapshot.geometry.contentRight);
  const decide = useDecide(snapshot.view);
  const [hovered, setHovered] = useHoveredEdit(snapshot.view);
  const sendCommentToChat = useWorkspaceStore((state) => state.sendCommentToChat);
  const setCommentResolved = useWorkspaceStore((state) => state.setCommentResolved);
  const handleSend = useCallback((id: string) => void sendCommentToChat(id), [sendCommentToChat]);
  const handleResolve = useCallback((id: string) => setCommentResolved(id, true), [setCommentResolved]);

  return (
    <div className="review-margin" role="complementary" aria-label="Review">
      {hovered ? <style>{`.cm-content [${EDIT_ATTRIBUTE}="${hovered}"] { background: var(--color-ai-surface); }`}</style> : null}
      <svg className="review-margin__leaders" aria-hidden>
        {leaders.map((path) => (
          <path key={path} d={path} />
        ))}
      </svg>
      {items.map((item) =>
        item.kind === "change" ? (
          <ChangeCard
            key={item.id}
            ref={register(item.id)}
            edit={item.edit}
            active={hovered === editDomId(item.edit)}
            onDecide={decide}
            onHover={setHovered}
          />
        ) : (
          <CommentCard
            key={item.id}
            ref={register(item.id)}
            comment={item.comment}
            agentName={agentName}
            onSend={handleSend}
            onResolve={handleResolve}
          />
        ),
      )}
    </div>
  );
}

/** The review margin of the open note. Renders nothing while the note has nothing to review. */
export function ReviewMargin({ agentName }: { agentName: string }) {
  const snapshot = useSyncExternalStore(reviewBridge.subscribe, reviewBridge.getSnapshot);
  if (!snapshot.view || !snapshot.marginHost || (snapshot.edits.length === 0 && snapshot.comments.length === 0)) {
    return null;
  }
  return createPortal(<Margin snapshot={snapshot} agentName={agentName} />, snapshot.marginHost);
}
