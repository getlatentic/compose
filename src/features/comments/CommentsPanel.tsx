import { useEffect, useMemo, useState } from "react";
import { ChatBot, Checkmark, Send, Undo, WarningAlt } from "@carbon/react/icons";
import type { AnchorResolutionState, WorkspaceCommentThread } from "./commentModel";

/** Plain-English label for an anchor that no longer sits exactly on its text. */
const RESOLUTION_LABEL: Record<Exclude<AnchorResolutionState, "resolved">, string> = {
  collapsed: "collapsed",
  contracted: "shortened",
  expanded: "expanded",
  moved: "moved",
  orphaned: "text deleted",
  replaced: "text changed",
  truncatedEnd: "end trimmed",
  truncatedStart: "start trimmed",
};

/**
 * The comment queue. Comments are created from the editor highlight (the
 * comment bubble's "Queue"); this panel stages them — select some and batch
 * them to the chat, or resolve the ones that are done.
 */
export function CommentsPanel({
  comments,
  filePath,
  onSendComments,
  onResolveComment,
  onReopenComment,
}: {
  comments: WorkspaceCommentThread[];
  filePath: string;
  onSendComments: (commentIds: string[]) => void;
  onResolveComment: (commentId: string) => void;
  onReopenComment: (commentId: string) => void;
}) {
  const openComments = useMemo(
    () => comments.filter((comment) => comment.status === "open"),
    [comments],
  );
  const resolvedComments = useMemo(
    () => comments.filter((comment) => comment.status === "resolved"),
    [comments],
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Drop selections for comments that are gone or no longer open.
  useEffect(() => {
    setSelectedIds((prev) => {
      const live = new Set(openComments.map((comment) => comment.id));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [openComments]);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const selectedCount = selectedIds.size;

  return (
    <aside className="comments-panel" aria-label="Comments">
      <div className="comments-header">
        <div>
          <div className="comments-eyebrow">Comments</div>
          <div className="comments-file">{filePath || "No file selected"}</div>
        </div>
        <span className="comments-count">{openComments.length}</span>
      </div>

      {openComments.length > 0 ? (
        <div className="comment-list-header">
          <span>Queue</span>
          {selectedCount > 0 ? (
            <button
              type="button"
              className="comment-send comment-send--bar"
              onClick={() => {
                onSendComments([...selectedIds]);
                setSelectedIds(new Set());
              }}
            >
              <ChatBot size={16} />
              Send {selectedCount} to chat
              <Send size={16} />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="comment-list">
        {openComments.length === 0 ? (
          <div className="comments-empty">
            Highlight text in the editor and choose <strong>Queue</strong> to stage a comment here,
            then batch-send them to the assistant.
          </div>
        ) : (
          openComments.map((comment) => {
            const { resolution } = comment.anchor;
            return (
              <article className="comment-card" key={comment.id}>
                <div className="comment-card__meta">
                  <label className="comment-card__select">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(comment.id)}
                      disabled={resolution === "orphaned"}
                      onChange={() => toggleSelected(comment.id)}
                    />
                    <span>Select</span>
                  </label>
                  <div className="comment-card__actions">
                    {resolution === "resolved" ? null : (
                      <span className="comment-card__state">
                        <WarningAlt size={14} />
                        {RESOLUTION_LABEL[resolution]}
                      </span>
                    )}
                    <button
                      type="button"
                      className="comment-resolve"
                      onClick={() => onResolveComment(comment.id)}
                    >
                      <Checkmark size={14} />
                      Resolve
                    </button>
                  </div>
                </div>
                <blockquote>{comment.anchor.selectedText}</blockquote>
                <p>{comment.body}</p>
              </article>
            );
          })
        )}
      </div>

      {resolvedComments.length > 0 ? (
        <>
          <div className="comment-list-header comment-list-header--resolved">
            <span>Resolved ({resolvedComments.length})</span>
          </div>
          <div className="comment-list">
            {resolvedComments.map((comment) => (
              <article className="comment-card comment-card--resolved" key={comment.id}>
                <div className="comment-card__meta">
                  <span className="comment-card__resolved-label">
                    <Checkmark size={14} />
                    Resolved
                  </span>
                  <button
                    type="button"
                    className="comment-resolve"
                    onClick={() => onReopenComment(comment.id)}
                  >
                    <Undo size={14} />
                    Reopen
                  </button>
                </div>
                <blockquote>{comment.anchor.selectedText}</blockquote>
                <p>{comment.body}</p>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </aside>
  );
}
