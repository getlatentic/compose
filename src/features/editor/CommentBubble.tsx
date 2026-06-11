import { ChatBot, Close, Edit, Send } from "@carbon/react/icons";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { bobRuntimeReadiness } from "../../app/workspaceModel";
import { useWorkspaceStore } from "../../app/workspaceStore";
import type { SourceRange } from "../comments/commentModel";

/**
 * Selection-anchored Bob trigger — what you see when you highlight
 * text in WYSIWYG mode.
 *
 * Two distinct user intents:
 *   * **Edit** — "rewrite this", "make it shorter", "translate to
 *     French". Bob receives the selection + instruction, returns
 *     a new chunk of markdown that REPLACES the selection. The
 *     document changes; the chat panel may also surface the
 *     thread for later reference.
 *   * **Ask** — "what does this mean?", "is this consistent with
 *     section 3?", "find a citation for this claim". Bob
 *     receives the selection + question and streams a response
 *     into the chat panel. The document doesn't change.
 *
 * Both share the same anchor (the user's text selection) and
 * both treat the markdown source as the canonical context. The
 * split is about intent, not infrastructure.
 *
 * UX shape mirrors Google Docs / Notion: a small floating
 * affordance appears at the right edge of the selection; click
 * it and an inline composer pops up below.
 */
export interface CommentBubbleProps {
  editor: Editor | null;
  selection: { text: string; range: SourceRange } | null;
  /**
   * Apply Bob's edit to the selection. Caller is responsible for
   * the round trip — sending the prompt + selection to Bob,
   * collecting Bob's response, and using the editor to replace
   * the selected text. The bubble fires-and-forgets.
   */
  onEditSelection?: (instruction: string, selection: { text: string; range: SourceRange }) => void;
  /**
   * Open a chat thread anchored to this selection. Caller routes
   * the message + selection context through the chat pipeline.
   */
  onAskAboutSelection?: (question: string, selection: { text: string; range: SourceRange }) => void;
}

type ComposeMode = "idle" | "edit" | "ask";

export function CommentBubble({
  editor,
  selection,
  onEditSelection,
  onAskAboutSelection,
}: CommentBubbleProps) {
  const [mode, setMode] = useState<ComposeMode>("idle");
  const [draft, setDraft] = useState("");
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Bob readiness — drives the "Set up Bob first" notice inside the
  // composer when the CLI / key / Node aren't all in place. We
  // still let the user open the composer and draft a question so
  // they can pick up where they left off after setup completes.
  const bobAuthStatus = useWorkspaceStore((state) => state.bobAuthStatus);
  const bobInstallStatus = useWorkspaceStore((state) => state.bobInstallStatus);
  const openSettings = useWorkspaceStore((state) => state.openSettings);
  const bobReady = bobRuntimeReadiness(bobAuthStatus, bobInstallStatus);

  // Recompute the anchor rect when the editor selection changes.
  // We read from window.getSelection() rather than ProseMirror
  // coords because the rect is already laid out by the browser
  // (works during scroll without re-derivation; matches how
  // Google Docs / Notion compute the same anchor).
  useEffect(() => {
    if (!editor || !selection) {
      setAnchorRect(null);
      if (mode !== "idle") setMode("idle");
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
    // Eslint thinks `mode` is missing from deps, but adding it
    // would create a loop: leaving compose mode → anchorRect
    // re-fires → mode resets → infinite.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, selection]);

  // Focus the textarea on compose-mode entry.
  useEffect(() => {
    if (mode !== "idle" && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode]);

  // Escape closes the composer.
  useEffect(() => {
    if (mode === "idle") return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMode("idle");
        setDraft("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  if (!anchorRect || !selection) return null;
  if (typeof document === "undefined") return null;

  const BUBBLE_OFFSET = 6;

  function submit() {
    const body = draft.trim();
    if (!body || !selection) return;
    if (mode === "edit") {
      onEditSelection?.(body, selection);
    } else if (mode === "ask") {
      onAskAboutSelection?.(body, selection);
    }
    setDraft("");
    setMode("idle");
  }

  // ---------- Idle: two-action pill ----------
  if (mode === "idle") {
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
          className="bob-selection-actions__button bob-selection-actions__button--edit"
          aria-label="Ask the assistant to edit this selection"
          title="Edit with the assistant"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMode("edit")}
        >
          <Edit size={14} />
          <span>Edit</span>
        </button>
        <span className="bob-selection-actions__divider" aria-hidden="true" />
        <button
          type="button"
          className="bob-selection-actions__button bob-selection-actions__button--ask"
          aria-label="Ask the assistant about this selection"
          title="Ask the assistant"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMode("ask")}
        >
          <ChatBot size={14} />
          <span>Ask</span>
        </button>
      </div>,
      document.body,
    );
  }

  // ---------- Compose: edit or ask popover ----------
  const COMPOSER_WIDTH = 360;
  const COMPOSER_HEIGHT_ESTIMATE = 200;
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

  const isEdit = mode === "edit";

  return createPortal(
    <div
      className="bob-selection-composer"
      role="dialog"
      aria-label={isEdit ? "Ask the assistant to edit selection" : "Ask the assistant about selection"}
      style={{ top: composerTop, left: composerLeft, width: COMPOSER_WIDTH }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="bob-selection-composer__header">
        <span className="bob-selection-composer__title">
          {isEdit ? <Edit size={14} /> : <ChatBot size={14} />}
          {isEdit ? "Edit with the assistant" : "Ask the assistant"}
        </span>
        <button
          type="button"
          className="bob-selection-composer__close"
          aria-label="Cancel"
          onClick={() => {
            setMode("idle");
            setDraft("");
          }}
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
        placeholder={
          isEdit
            ? "What change should the assistant make? e.g. 'shorter', 'as a list', 'translate to French'…"
            : "Ask the assistant about this selection…"
        }
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
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
        <span className="bob-selection-composer__hint">⌘+Enter to send</span>
        <button
          type="button"
          className="bob-selection-composer__primary"
          disabled={!draft.trim() || !bobReady.ready}
          onClick={submit}
          title={bobReady.ready ? undefined : (bobReady.message ?? "The assistant isn't connected yet.")}
        >
          {isEdit ? (
            <>
              <Edit size={14} />
              Apply edit
            </>
          ) : (
            <>
              <Send size={14} />
              Send to chat
            </>
          )}
        </button>
      </div>
    </div>,
    document.body,
  );
}
