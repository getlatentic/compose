import { forwardRef, useCallback } from "react";
import { Check, MessageSquare, Undo2, X } from "lucide-react";

import { blockId, type LiveBlock } from "./liveBlocks";
import type { LiveComment } from "./reviewBridge";
import { wordCount, wordDiff } from "./wordDiff";

function words(count: number): string {
  return `${count} word${count === 1 ? "" : "s"}`;
}

/** Words the change took out and put in, not counting the words it kept. */
function changedWords(block: Pick<LiveBlock, "removed" | "added">): { removed: number; added: number } {
  const removedLines = block.removed.split("\n");
  const addedLines = block.added.split("\n");
  if (removedLines.length !== addedLines.length) {
    return { removed: wordCount(block.removed), added: wordCount(block.added) };
  }
  let removed = 0;
  let added = 0;
  removedLines.forEach((line, index) => {
    for (const segment of wordDiff(line, addedLines[index])) {
      if (segment.kind === "removed") removed += wordCount(segment.text);
      if (segment.kind === "added") added += wordCount(segment.text);
    }
  });
  return { removed, added };
}

/** A plain, true account of what the change did: the agent gives no reason per change. */
export function describeChange(block: Pick<LiveBlock, "removed" | "added">): string {
  const { removed, added } = changedWords(block);
  if (removed > 0 && added > 0) return `Replaced ${words(removed)} with ${words(added)}.`;
  if (added > 0) return `Added ${words(added)}.`;
  if (removed > 0) return `Removed ${words(removed)}.`;
  return "Changed the layout of this passage.";
}

interface ChangeCardProps {
  readonly block: LiveBlock;
  readonly inline?: boolean;
  readonly onDecide: (block: LiveBlock, takeOtherSide: boolean, kept: boolean) => void;
}

/**
 * One agent change. Applied (the default): Keep or Undo, since the change is
 * already in the note. Pending ("Review changes before applying"): Accept or
 * Reject.
 */
export const ChangeCard = forwardRef<HTMLElement, ChangeCardProps>(function ChangeCard(
  { block, inline = false, onDecide },
  ref,
) {
  const applied = block.mode === "applied";
  // Applied: Keep leaves the note alone; Undo swaps the old text back.
  // Pending: Accept swaps the new text in; Reject leaves the note alone.
  const handlePrimary = useCallback(() => onDecide(block, !applied, true), [onDecide, block, applied]);
  const handleSecondary = useCallback(() => onDecide(block, applied, false), [onDecide, block, applied]);
  return (
    <article
      ref={ref}
      className={`review-card${inline ? " review-card--inline" : ""}`}
      data-review-id={blockId(block)}
      aria-label={`${block.agentName} ${applied ? "changed" : "suggests"}: ${describeChange(block)}`}
    >
      <p className="review-card__head">
        <span className="review-card__author">{block.agentName}</span> {applied ? "changed" : "suggests"}
      </p>
      <p className="review-card__body">{describeChange(block)}</p>
      <div className="review-card__actions">
        <button type="button" className="review-card__button review-card__button--primary" onClick={handlePrimary}>
          <Check size={14} strokeWidth={2} aria-hidden />
          {applied ? "Keep" : "Accept"}
        </button>
        <button type="button" className="review-card__button" onClick={handleSecondary}>
          {applied ? <Undo2 size={14} strokeWidth={2} aria-hidden /> : <X size={14} strokeWidth={2} aria-hidden />}
          {applied ? "Undo" : "Reject"}
        </button>
      </div>
    </article>
  );
});

interface CommentCardProps {
  readonly comment: LiveComment;
  readonly agentName: string;
  readonly onSend: (commentId: string) => void;
  readonly onResolve: (commentId: string) => void;
}

/** A comment the writer left on a passage: hand it to the agent, or mark it done. */
export const CommentCard = forwardRef<HTMLElement, CommentCardProps>(function CommentCard(
  { comment, agentName, onSend, onResolve },
  ref,
) {
  const handleSend = useCallback(() => onSend(comment.id), [onSend, comment.id]);
  const handleResolve = useCallback(() => onResolve(comment.id), [onResolve, comment.id]);
  return (
    <article ref={ref} className="review-card review-card--comment" aria-label={`Your comment: ${comment.body}`}>
      <p className="review-card__head">
        <span className="review-card__author review-card__author--you">You</span> commented
      </p>
      <p className="review-card__body">{comment.body}</p>
      <div className="review-card__actions">
        <button type="button" className="review-card__button review-card__button--outline" onClick={handleSend}>
          <MessageSquare size={14} strokeWidth={2} aria-hidden />
          Send to {agentName}
        </button>
        <button type="button" className="review-card__button" onClick={handleResolve}>
          <Check size={14} strokeWidth={2} aria-hidden />
          Resolve
        </button>
      </div>
    </article>
  );
});
