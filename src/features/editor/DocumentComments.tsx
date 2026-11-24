import { useCallback, useState, type CSSProperties } from "react";

import { useWorkspaceStore } from "../../app/workspaceStore";
import type { SourceRange } from "../comments/commentModel";
import { CommentComposer } from "./CommentBubble";

type Excerpt = { range: SourceRange; text: string };
type Point = { x: number; y: number };

/** The composer's width, the same as the selection composer's. */
const COMPOSER_WIDTH = 360;

/** Just below the click, kept inside the window. */
function composerStyle(anchor: Point): CSSProperties {
  const left = Math.min(Math.max(16, anchor.x - COMPOSER_WIDTH / 2), window.innerWidth - COMPOSER_WIDTH - 16);
  const top = Math.min(anchor.y + 8, window.innerHeight - 240);
  return { top, left, width: COMPOSER_WIDTH };
}

/**
 * What a selection can become: a question to the agent, or a comment kept
 * on the note. Stable, so the memoised editor's props stay the same.
 */
export function useSelectionComments() {
  const askAboutSelectionStream = useWorkspaceStore((state) => state.askAboutSelectionStream);
  const addCommentToActiveFile = useWorkspaceStore((state) => state.addCommentToActiveFile);
  const askAgent = useCallback(
    (question: string, selection: Excerpt) => void askAboutSelectionStream(question, selection),
    [askAboutSelectionStream],
  );
  const keepComment = useCallback(
    (note: string, selection: Excerpt) => addCommentToActiveFile({ body: note, range: selection.range, selectedText: selection.text }),
    [addCommentToActiveFile],
  );
  return { askAgent, keepComment };
}

/**
 * "Comment on this table row/column" from the table's right-click menu: the
 * same composer a selection uses, near the click, seeded with the excerpt.
 */
export function useTableComment(enabled: boolean) {
  const [open, setOpen] = useState<{ excerpt: Excerpt; anchor: Point } | null>(null);
  const openComment = useCallback(
    (excerpt: Excerpt, anchor: Point) => {
      if (enabled) setOpen({ excerpt, anchor });
    },
    [enabled],
  );
  // The menu tinted the commented row or column; closing takes the tint off.
  const close = useCallback(() => {
    document.querySelectorAll(".cm-table-cell--commenting").forEach((cell) => cell.classList.remove("cm-table-cell--commenting"));
    setOpen(null);
  }, []);
  return { open, openComment, close };
}

interface TableCommentComposerProps {
  readonly excerpt: Excerpt;
  readonly anchor: Point;
  readonly onAsk: (question: string, selection: Excerpt) => void;
  readonly onKeep: (note: string, selection: Excerpt) => void;
  readonly onClose: () => void;
}

/** The open table comment: send it to the agent or keep it, then close. */
export function TableCommentComposer({ excerpt, anchor, onAsk, onKeep, onClose }: TableCommentComposerProps) {
  const send = useCallback(
    (note: string) => {
      onAsk(note, excerpt);
      onClose();
    },
    [onAsk, excerpt, onClose],
  );
  const queue = useCallback(
    (note: string) => {
      onKeep(note, excerpt);
      onClose();
    },
    [onKeep, excerpt, onClose],
  );
  return <CommentComposer selectionText={excerpt.text} style={composerStyle(anchor)} onSend={send} onQueue={queue} onClose={onClose} />;
}
