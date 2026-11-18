import { blockKeys, changeBlocks, type ChangeBlock } from "./changeBlocks";

/**
 * - `applied`: the agent already wrote the file (the default). The note holds
 *   the new text; a change can be kept or undone.
 * - `pending`: "Review changes before applying" is on. The note still holds
 *   the old text; a change can be accepted or rejected.
 */
export type ReviewMode = "applied" | "pending";

/** One agent run's change to one note, as the margin reviews it. */
export interface FileReview {
  /** The chat record it came from (a suggestion or an applied change). */
  readonly id: string;
  readonly mode: ReviewMode;
  readonly agentName: string;
  /** The note body (front matter removed) before the run. */
  readonly original: string;
  /** The note body after the run. */
  readonly proposed: string;
  /** Keys of the blocks already kept, undone, accepted or rejected. */
  readonly decided: readonly string[];
}

/** An undecided change block, found in the note as it is now. */
export interface LiveBlock {
  readonly reviewId: string;
  readonly key: string;
  readonly mode: ReviewMode;
  readonly agentName: string;
  /** Character range in the note of the text the change put there (applied)
   *  or would take out (pending). Empty for an insertion point. */
  readonly from: number;
  readonly to: number;
  /** What replaces `from`–`to` to undo (applied) or accept (pending) it. */
  readonly replacement: string;
  /** The block's old and new text, for the card and the inline marks. */
  readonly removed: string;
  readonly added: string;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) {
    starts.push(index + 1);
  }
  return starts;
}

/**
 * The note range of `count` lines starting at `line`, and the text that
 * swaps them for `other`. Whole lines, with the newline handled so that
 * deleting or inserting lines leaves no blank line behind.
 */
export function lineSpan(
  text: string,
  starts: readonly number[],
  line: number,
  count: number,
  other: readonly string[],
): { from: number; to: number; replacement: string } {
  const lineCount = text === "" ? 0 : text.endsWith("\n") ? starts.length - 1 : starts.length;
  const startOf = (index: number) => (index < starts.length ? starts[index] : text.length);
  if (count > 0 && other.length > 0) {
    const endOfLast = startOf(line + count) - (line + count < starts.length ? 1 : 0);
    return { from: startOf(line), to: endOfLast, replacement: other.join("\n") };
  }
  if (count > 0) {
    // Remove whole lines, newline included. At the end of the note there is no
    // following newline, so take the one before instead.
    if (line + count < lineCount) {
      return { from: startOf(line), to: startOf(line + count), replacement: "" };
    }
    const end = text.endsWith("\n") ? text.length - 1 : text.length;
    return { from: Math.max(0, startOf(line) - 1), to: end, replacement: "" };
  }
  if (line < lineCount) {
    const at = startOf(line);
    return { from: at, to: at, replacement: `${other.join("\n")}\n` };
  }
  const inserted = other.join("\n");
  if (text === "") {
    return { from: 0, to: 0, replacement: inserted };
  }
  return text.endsWith("\n")
    ? { from: text.length, to: text.length, replacement: `${inserted}\n` }
    : { from: text.length, to: text.length, replacement: `\n${inserted}` };
}

/**
 * The review's undecided blocks that are still in the note, with their
 * current position.
 *
 * The note is diffed against the other side of the run (the original for an
 * applied run, the proposal for a pending one), and a block of that diff
 * counts only if it is exactly a block the agent made. So a change the writer
 * made since, anywhere, never shows up as the agent's, and a block the writer
 * has edited by hand drops out of review instead of offering a stale swap.
 */
export function liveBlocks(review: FileReview, note: string): LiveBlock[] {
  const agentBlocks = changeBlocks(review.original, review.proposed);
  const decided = new Set(review.decided);
  const wanted = new Set(blockKeys(agentBlocks).filter((key) => !decided.has(key)));
  if (wanted.size === 0) {
    return [];
  }
  const current =
    review.mode === "applied" ? changeBlocks(review.original, note) : changeBlocks(note, review.proposed);
  const keys = blockKeys(current);
  const starts = lineStarts(note);
  const found: LiveBlock[] = [];
  current.forEach((block, index) => {
    if (!wanted.has(keys[index])) {
      return;
    }
    found.push(locate(review, block, keys[index], note, starts));
  });
  return found;
}

function locate(
  review: FileReview,
  block: ChangeBlock,
  key: string,
  note: string,
  starts: readonly number[],
): LiveBlock {
  const span =
    review.mode === "applied"
      ? lineSpan(note, starts, block.afterLine, block.added.length, block.removed)
      : lineSpan(note, starts, block.beforeLine, block.removed.length, block.added);
  return {
    reviewId: review.id,
    key,
    mode: review.mode,
    agentName: review.agentName,
    ...span,
    removed: block.removed.join("\n"),
    added: block.added.join("\n"),
  };
}

/** Unique across reviews: two runs can make the same edit. */
export function blockId(block: Pick<LiveBlock, "reviewId" | "key">): string {
  return `${block.reviewId}\n${block.key}`;
}

/** Undecided blocks of every review on the note, in document order. */
export function allLiveBlocks(reviews: readonly FileReview[], note: string): LiveBlock[] {
  return reviews.flatMap((review) => liveBlocks(review, note)).sort((a, b) => a.from - b.from);
}

/** How many blocks a review has in all, decided or not. */
export function reviewBlockCount(review: Pick<FileReview, "original" | "proposed">): number {
  return changeBlocks(review.original, review.proposed).length;
}

/** The keys of a review's blocks, for recording a decision against. */
export function reviewBlockKeys(review: Pick<FileReview, "original" | "proposed">): string[] {
  return blockKeys(changeBlocks(review.original, review.proposed));
}
