import { AddComment, Close, ListBulleted, Send } from "@carbon/react/icons";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bobRuntimeReadiness } from "../../app/workspaceModel";
import { useWorkspaceStore } from "../../app/workspaceStore";
import type { SourceRange } from "../comments/commentModel";

/**
 * Selection-anchored comment trigger — what you see when you highlight text.
 *
 * A comment is a note on the highlighted passage. You don't pre-pick "edit" vs
 * "ask": you write the note and the assistant decides (answer or edit) from it.
 * Two destinations:
 *   * **Send to chat** — one-off; the note + selection go to the chat now and
 *     the assistant responds (answering or editing). The panel isn't involved.
 *   * **Queue** — stage the note as a comment in the panel, to batch-send later.
 *
 * UX mirrors Google Docs / Notion: a small "Comment" affordance at the edge of
 * the selection; click it and an inline composer pops up below.
 */
export interface CommentBubbleProps {
  editor: Editor | null;
  selection: { text: string; range: SourceRange } | null;
  /** Send the note + selection to the chat now (assistant answers or edits). */
  onSendToChat?: (note: string, selection: { text: string; range: SourceRange }) => void;
  /** Stage the note as a comment in the panel queue (batch-send later). */
  onQueueComment?: (note: string, selection: { text: string; range: SourceRange }) => void;
}

export function CommentBubble({
  editor,
  selection,
  onSendToChat,
  onQueueComment,
}: CommentBubbleProps) {
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState("");
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Readiness drives the "set up the assistant" notice; the send still works
  // through the run's own preflight, so the buttons don't hard-gate on it.
  const bobAuthStatus = useWorkspaceStore((state) => state.bobAuthStatus);
  const bobInstallStatus = useWorkspaceStore((state) => state.bobInstallStatus);
  const openSettings = useWorkspaceStore((state) => state.openSettings);
  const bobReady = bobRuntimeReadiness(bobAuthStatus, bobInstallStatus);

  // Recompute the anchor rect when the editor selection changes.
  useEffect(() => {
    if (!editor || !selection) {
      setAnchorRect(null);
      if (composing) setComposing(false);
      return;
    }
    const win = typeof window !== "undefined" ? window.getSelection() : null;
    if (!win || win.rangeCount === 0 || win.isCollapsed) {
      setAnchorRect(null);
      return;
    }
    const range = win.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setAnchorRect(null);
      return;
    }
    setAnchorRect(rect);
    // Adding `composing` would loop: closing the composer re-fires this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, selection]);

  // Focus the textarea when the composer opens.
  useEffect(() => {
    if (composing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [composing]);

  // Escape closes the composer.
  useEffect(() => {
    if (!composing) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setComposing(false);
        setDraft("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [composing]);

  if (!anchorRect || !selection) return null;
  if (typeof document === "undefined") return null;

  const BUBBLE_OFFSET = 6;

  function close() {
    setComposing(false);
    setDraft("");
  }

  /** After a comment lands, dismiss the whole bubble — not just the
   * composer. `close()` alone drops back to the pill, because the editor
   * selection (which drives the upstream `bubbleSelection`) is still
   * non-empty; collapsing it routes through `onSelectionUpdate`, which
   * clears the selection snapshot and unmounts the bubble. (Escape / the
   * X keep the pill on purpose — the user may still want to comment.) */
  function dismissAfterAction() {
    close();
    if (editor) {
      editor.commands.setTextSelection(editor.state.selection.to);
    }
  }

  function sendToChat() {
    const note = draft.trim();
    if (!note || !selection) return;
    onSendToChat?.(note, selection);
    dismissAfterAction();
  }

  function queue() {
    const note = draft.trim();
    if (!note || !selection) return;
    onQueueComment?.(note, selection);
    dismissAfterAction();
  }

  // ---------- Pill: a single "Comment" trigger ----------
  if (!composing) {
    const top = anchorRect.top - 36;
    const left = anchorRect.right + BUBBLE_OFFSET;
    return createPortal(
      <div
        className="bob-selection-actions"
        role="toolbar"
        aria-label="Actions for selection"
        style={{ top, left }}
      >
        <button
          type="button"
          className="bob-selection-actions__button bob-selection-actions__button--ask"
          aria-label="Comment on this selection"
          title="Comment"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setComposing(true)}
        >
          <AddComment size={14} />
          <span>Comment</span>
        </button>
      </div>,
      document.body,
    );
  }

  // ---------- Composer: a note → Send to chat / Queue ----------
  const COMPOSER_WIDTH = 360;
  const COMPOSER_HEIGHT_ESTIMATE = 220;
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;
  let composerTop = anchorRect.bottom + BUBBLE_OFFSET;
  if (composerTop + COMPOSER_HEIGHT_ESTIMATE > viewportHeight - 16) {
    composerTop = Math.max(16, anchorRect.top - COMPOSER_HEIGHT_ESTIMATE - BUBBLE_OFFSET);
  }
  let composerLeft = anchorRect.left + anchorRect.width / 2 - COMPOSER_WIDTH / 2;
  if (composerLeft < 16) composerLeft = 16;
  if (composerLeft + COMPOSER_WIDTH > viewportWidth - 16) {
    composerLeft = viewportWidth - COMPOSER_WIDTH - 16;
  }
  const hasDraft = Boolean(draft.trim());

  return createPortal(
    <div
      className="bob-selection-composer"
      role="dialog"
      aria-label="Comment on selection"
      style={{ top: composerTop, left: composerLeft, width: COMPOSER_WIDTH }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="bob-selection-composer__header">
        <span className="bob-selection-composer__title">
          <AddComment size={14} />
          Comment
        </span>
        <button
          type="button"
          className="bob-selection-composer__close"
          aria-label="Cancel"
          onClick={close}
        >
          <Close size={14} />
        </button>
      </div>
      <blockquote className="bob-selection-composer__selection">
        {selection.text.length > 280 ? selection.text.slice(0, 280) + "…" : selection.text}
      </blockquote>
      <textarea
        ref={textareaRef}
        className="bob-selection-composer__textarea"
        placeholder="Leave a note — the assistant answers or edits based on what you write…"
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            sendToChat();
          }
        }}
      />
      {!bobReady.ready ? (
        <div className="bob-selection-composer__notice" role="status">
          <span>{bobReady.message ?? "The assistant isn't connected yet."}</span>
          <button
            type="button"
            className="bob-selection-composer__setup"
            onClick={() => openSettings()}
          >
            Set up the assistant →
          </button>
        </div>
      ) : null}
      <div className="bob-selection-composer__actions">
        <button
          type="button"
          className="bob-selection-composer__secondary"
          disabled={!hasDraft}
          onClick={queue}
          title="Add to the comment queue in the panel"
        >
          <ListBulleted size={14} />
          Queue
        </button>
        <button
          type="button"
          className="bob-selection-composer__primary"
          disabled={!hasDraft}
          onClick={sendToChat}
        >
          <Send size={14} />
          Send to chat
        </button>
      </div>
    </div>,
    document.body,
  );
}
