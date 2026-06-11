import { useState } from "react";
import { AddComment, ChatBot, Send, WarningAlt } from "@carbon/react/icons";
import type { SourceRange, WorkspaceCommentThread } from "./commentModel";

export interface EditorSelectionSnapshot {
  range: SourceRange;
  text: string;
}

export function CommentsPanel({
  comments,
  filePath,
  onCreateComment,
  onSendComment,
  selection,
}: {
  comments: WorkspaceCommentThread[];
  filePath: string;
  onCreateComment: (body: string, selection: EditorSelectionSnapshot) => void;
  onSendComment: (commentId: string) => void;
  selection: EditorSelectionSnapshot | null;
}) {
  const [draft, setDraft] = useState("");
  const canCreate = Boolean(selection && draft.trim());

  function handleCreate() {
    if (!selection || !draft.trim()) {
      return;
    }
    onCreateComment(draft, selection);
    setDraft("");
  }

  return (
    <aside className="bob-comments-panel" aria-label="Comments">
      <div className="bob-comments-header">
        <div>
          <div className="bob-comments-eyebrow">Comments</div>
          <div className="bob-comments-file">{filePath || "No file selected"}</div>
        </div>
        <span className="bob-comments-count">{comments.length}</span>
      </div>

      <div className="bob-comment-compose">
        <div className="bob-comment-compose__title">
          <AddComment size={16} />
          <span>Comment on selection</span>
        </div>
        {selection ? (
          <blockquote className="bob-comment-selection">{selection.text}</blockquote>
        ) : (
          <p className="bob-comment-empty-copy">Select text in the editor to anchor a comment.</p>
        )}
        <textarea
          aria-label="Comment body"
          disabled={!selection}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask the assistant or leave a note..."
          rows={3}
        />
        <button
          type="button"
          className="bob-comment-primary"
          disabled={!canCreate}
          onClick={handleCreate}
        >
          Add comment
        </button>
      </div>

      <div className="bob-comment-list">
        {comments.length === 0 ? (
          <div className="bob-comments-empty">
            Local comments stay out of the Markdown file and can be sent to the assistant when needed.
          </div>
        ) : (
          comments.map((comment) => (
            <article className="bob-comment-card" key={comment.id}>
              <div className="bob-comment-card__meta">
                {comment.anchor.resolution === "resolved" ? null : (
                  <span className="bob-comment-card__state">
                    <WarningAlt size={14} />
                    {comment.anchor.resolution}
                  </span>
                )}
                <span>
                  bytes {comment.anchor.range.start}-{comment.anchor.range.end}
                </span>
              </div>
              <blockquote>{comment.anchor.selectedText}</blockquote>
              <p>{comment.body}</p>
              <button
                type="button"
                className="bob-comment-send"
                onClick={() => onSendComment(comment.id)}
              >
                <ChatBot size={16} />
                Send to chat
                <Send size={16} />
              </button>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
