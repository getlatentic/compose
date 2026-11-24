import type { LiveComment, MarginComment } from "./reviewBridge";

/** How much of the saved context either side has to match to pick an occurrence. */
const CONTEXT_CHARS = 24;

function contextScore(note: string, at: number, comment: MarginComment): number {
  const before = comment.prefix.slice(-CONTEXT_CHARS);
  const after = comment.suffix.slice(0, CONTEXT_CHARS);
  let score = 0;
  if (before && note.slice(Math.max(0, at - before.length), at) === before) score += 1;
  const end = at + comment.selectedText.length;
  if (after && note.slice(end, end + after.length) === after) score += 1;
  return score;
}

/**
 * Where a comment's passage is in the note now, found by its text rather than
 * by a stored offset, so it survives edits around it and the front matter the
 * editor does not show. Of several occurrences, the one whose surroundings
 * match the saved context wins; none found means the passage is gone.
 */
export function locateComment(note: string, comment: MarginComment): LiveComment | null {
  if (!comment.selectedText) return null;
  let best = -1;
  let bestScore = -1;
  for (let at = note.indexOf(comment.selectedText); at !== -1; at = note.indexOf(comment.selectedText, at + 1)) {
    const score = contextScore(note, at, comment);
    if (score > bestScore) {
      best = at;
      bestScore = score;
    }
    if (score === 2) break;
  }
  return best === -1 ? null : { ...comment, from: best };
}
