import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { useWorkspaceStore } from "../../app/workspaceStore";
import { blockId, type LiveBlock } from "./liveBlocks";
import { reviewBridge, type LiveComment, type ReviewSnapshot } from "./reviewBridge";
import { ChangeCard, CommentCard } from "./ReviewCard";
import { currentBlocks } from "./reviewExtension";

/** Gap between the note column and a card; the leader runs across it. */
const GAP_PX = 56;
const CARD_GAP_PX = 12;
/** Where on a card its leader arrives: level with the card's first line. */
const LEADER_Y_PX = 15;

type MarginItem =
  | { kind: "change"; id: string; top: number; block: LiveBlock }
  | { kind: "comment"; id: string; top: number; comment: LiveComment };

function marginItems(snapshot: ReviewSnapshot): MarginItem[] {
  const { tops } = snapshot.geometry;
  const items: MarginItem[] = [];
  for (const block of snapshot.blocks) {
    const top = tops.get(blockId(block));
    if (top !== undefined) items.push({ kind: "change", id: blockId(block), top, block });
  }
  for (const comment of snapshot.comments) {
    const top = tops.get(comment.id);
    if (top !== undefined) items.push({ kind: "comment", id: comment.id, top, comment });
  }
  return items.sort((a, b) => a.top - b.top);
}

/** The editor's latest positions for the block, so a swap lands on the text as it is now. */
function freshBlock(snapshot: ReviewSnapshot, block: LiveBlock): LiveBlock | null {
  if (!snapshot.view) return null;
  return currentBlocks(snapshot.view).find((candidate) => blockId(candidate) === blockId(block)) ?? null;
}

function useDecide(snapshot: ReviewSnapshot) {
  const decideReviewBlock = useWorkspaceStore((state) => state.decideReviewBlock);
  return useCallback(
    (block: LiveBlock, takeOtherSide: boolean, kept: boolean) => {
      const view = snapshot.view;
      const current = freshBlock(snapshot, block);
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
    [snapshot, decideReviewBlock],
  );
}

/**
 * Cards beside the note, each level with its line, pushed down where they
 * would overlap, and tied back to the line by a hairline leader.
 */
function WideMargin({ snapshot, agentName }: { snapshot: ReviewSnapshot; agentName: string }) {
  const items = useMemo(() => marginItems(snapshot), [snapshot]);
  const cards = useRef(new Map<string, HTMLElement>());
  const [leaders, setLeaders] = useState<string[]>([]);
  const decide = useDecide(snapshot);
  const sendCommentToChat = useWorkspaceStore((state) => state.sendCommentToChat);
  const setCommentResolved = useWorkspaceStore((state) => state.setCommentResolved);
  const handleSend = useCallback((id: string) => void sendCommentToChat(id), [sendCommentToChat]);
  const handleResolve = useCallback((id: string) => setCommentResolved(id, true), [setCommentResolved]);
  const left = snapshot.geometry.contentRight + GAP_PX;

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
      const lineY = item.top + LEADER_Y_PX;
      const cardY = top + LEADER_Y_PX;
      const start = snapshot.geometry.contentRight + 12;
      paths.push(`M${start} ${lineY} H${left - 16} L${left} ${cardY}`);
    }
    setLeaders((previous) => (previous.join() === paths.join() ? previous : paths));
  }, [items, left, snapshot.geometry.contentRight]);

  const register = useCallback((id: string) => (element: HTMLElement | null) => {
    if (element) cards.current.set(id, element);
    else cards.current.delete(id);
  }, []);

  return (
    <div className="review-margin" role="complementary" aria-label="Review">
      <svg className="review-margin__leaders" aria-hidden>
        {leaders.map((path) => (
          <path key={path} d={path} />
        ))}
      </svg>
      {items.map((item) =>
        item.kind === "change" ? (
          <ChangeCard key={item.id} ref={register(item.id)} block={item.block} onDecide={decide} />
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

/** No room beside the note: each change's card sits under its paragraph instead. */
function FoldedCards({ snapshot }: { snapshot: ReviewSnapshot }) {
  const decide = useDecide(snapshot);
  const { view, slots, blocks } = snapshot;
  // The slots are block widgets; once a card fills one, the editor has to
  // measure the line heights again or clicks below it land a line off.
  useLayoutEffect(() => {
    view?.requestMeasure();
  }, [view, slots, blocks]);
  return (
    <>
      {blocks.map((block) => {
        const slot = slots.get(blockId(block));
        return slot ? createPortal(<ChangeCard block={block} inline onDecide={decide} />, slot, blockId(block)) : null;
      })}
    </>
  );
}

/** The review margin of the open note. Renders nothing while the note has nothing to review. */
export function ReviewMargin({ agentName }: { agentName: string }) {
  const snapshot = useSyncExternalStore(reviewBridge.subscribe, reviewBridge.getSnapshot);
  if (!snapshot.view || (snapshot.blocks.length === 0 && snapshot.comments.length === 0)) {
    return null;
  }
  if (snapshot.folded) {
    return <FoldedCards snapshot={snapshot} />;
  }
  return snapshot.marginHost ? createPortal(<WideMargin snapshot={snapshot} agentName={agentName} />, snapshot.marginHost) : null;
}
