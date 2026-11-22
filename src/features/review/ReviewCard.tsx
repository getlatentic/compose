import { forwardRef, useCallback, type MouseEvent } from "react";
import { Check, MessageSquare, Undo2, X } from "lucide-react";

import { useLeaveAnimation } from "../shared/useLeaveAnimation";
import type { LiveEdit } from "./liveEdits";
import type { LiveComment } from "./reviewBridge";
import { editDomId } from "./reviewDecorations";

/** Longest run of an edit's words a card quotes; the note shows the rest. */
const MAX_CARD_CHARS = 160;

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_CARD_CHARS ? `${flat.slice(0, MAX_CARD_CHARS - 1).trimEnd()}…` : flat;
}

/** The edit in words, for a screen reader: what was there and what is. */
export function describeEdit(edit: Pick<LiveEdit, "removed" | "added">): string {
  const removed = clip(edit.removed);
  const added = clip(edit.added);
  if (removed && added) return `replaced "${removed}" with "${added}"`;
  if (added) return `added "${added}"`;
  if (removed) return `removed "${removed}"`;
  return "changed the spacing";
}

/** The edit's own words: the old struck through, the new underlined. */
function EditWords({ edit }: { edit: Pick<LiveEdit, "removed" | "added"> }) {
  const removed = clip(edit.removed);
  const added = clip(edit.added);
  if (!removed && !added) return <p className="review-card__body">Changed the spacing.</p>;
  return (
    <p className="review-card__body">
      {!removed ? <span className="review-card__verb">Added </span> : null}
      {!added ? <span className="review-card__verb">Removed </span> : null}
      {removed ? <del className="review-card__old">{removed}</del> : null}
      {removed && added ? <span className="review-card__arrow" aria-hidden> → </span> : null}
      {added ? <ins className="review-card__new">{added}</ins> : null}
    </p>
  );
}

interface ChangeCardProps {
  readonly edit: LiveEdit;
  readonly active: boolean;
  readonly onDecide: (edit: LiveEdit, takeOtherSide: boolean, kept: boolean) => void;
  readonly onHover: (domId: string | null) => void;
}

/**
 * One agent edit. Applied (the default): Keep or Undo, since the edit is
 * already in the note. Pending ("Review changes before applying"): Accept or
 * Reject.
 */
export const ChangeCard = forwardRef<HTMLElement, ChangeCardProps>(function ChangeCard(
  { edit, active, onDecide, onHover },
  ref,
) {
  const applied = edit.mode === "applied";
  const domId = editDomId(edit);
  // Applied: Keep leaves the note alone; Undo swaps the old words back.
  // Pending: Accept swaps the new words in; Reject leaves the note alone.
  const { leaving, leave } = useLeaveAnimation();
  const handlePrimary = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => leave(event.currentTarget, () => onDecide(edit, !applied, true)),
    [leave, onDecide, edit, applied],
  );
  const handleSecondary = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => leave(event.currentTarget, () => onDecide(edit, applied, false)),
    [leave, onDecide, edit, applied],
  );
  const handleEnter = useCallback(() => onHover(domId), [onHover, domId]);
  const handleLeave = useCallback(() => onHover(null), [onHover]);
  return (
    <article
      ref={ref}
      className={`review-card${active ? " review-card--active" : ""}${leaving ? " review-card--leaving" : ""}`}
      data-review-id={domId}
      aria-label={`${edit.agentName} ${applied ? "changed" : "suggests"}: ${describeEdit(edit)}`}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
    >
      <p className="review-card__head">
        <span className="review-card__author">{edit.agentName}</span> {applied ? "changed" : "suggests"}
      </p>
      <EditWords edit={edit} />
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
