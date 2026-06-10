/**
 * Comment-overlap index — slice B5.
 *
 * The canvas renderer paints a per-line background highlight wherever
 * an open comment's anchor range overlaps the line. Before this
 * index, the implementation was a literal `comments.some(c =>
 * rangesOverlap(line.range, c.anchor.range))` called once per visible
 * line on every paint. That's O(comments × visible_lines) — fine for
 * a handful of comments, but a 1000-comment vault doing 60fps paints
 * burns measurable time on it (the committed lag baseline shows
 * `commentOverlay1000` on xlarge at ~0.4ms per paint).
 *
 * This module replaces that scan with an O(log n + k) lookup. The
 * structure is a sorted-by-start array plus an augmented `maxEndUpTo`
 * prefix-max array, packed in a `Uint32Array` for SIMD-friendly
 * scanning. No allocations during query — exactly the pattern
 * `CLAUDE.md` "preallocated typed array" rule calls for.
 *
 * Design choice — augmented binary search vs full interval tree:
 *
 *   * Augmented binary search has the data structure of "sort + a
 *     parallel max-so-far Uint32Array". Build is O(n log n) (sort).
 *     Query is O(log n) binary search + a backward scan that early-
 *     terminates as soon as no remaining entry can overlap.
 *   * A full interval tree (red-black or augmented BST) does O(log n
 *     + k) deterministically. The implementation is ~300 LOC,
 *     allocation-heavy, and doesn't pay off until comment counts
 *     reach the tens of thousands — well past anything a real
 *     vault produces today.
 *
 * The simple structure is the right tool. Upgrade only if a real
 * vault appears with so many comments that the backward-scan tail
 * becomes a bottleneck.
 */

import type {
  SourceRange,
  WorkspaceCommentThread,
} from "./commentModel";

interface IndexedComment {
  start: number;
  end: number;
  comment: WorkspaceCommentThread;
}

/**
 * Singleton "empty" index used as the default when the editor has no
 * comments — saves a fresh `Uint32Array(0)` allocation per render
 * cycle and lets identity-based `useMemo` caching elide rebuilds.
 */
const EMPTY_INDEX_SENTINEL: IndexedComment[] = [];
const EMPTY_MAX_END: Uint32Array = new Uint32Array(0);

export class CommentRangeIndex {
  /** Sorted by `start` ascending; `end` is from the same anchor. */
  private readonly sorted: IndexedComment[];
  /**
   * Prefix-max over `sorted.end`. `maxEndUpTo[i] = max(sorted[0..=i].end)`.
   * The key trick that turns the backward scan into log-time-ish:
   * if `maxEndUpTo[i] <= query.start`, no entry in `[0..=i]` can
   * possibly reach into the query range, so we stop.
   */
  private readonly maxEndUpTo: Uint32Array;

  /**
   * Build an index over the open subset of `comments`. Closed /
   * resolved comments are excluded — they don't paint anyway and
   * keeping them out shrinks both the index and the query cost.
   */
  constructor(comments: readonly WorkspaceCommentThread[]) {
    if (comments.length === 0) {
      this.sorted = EMPTY_INDEX_SENTINEL;
      this.maxEndUpTo = EMPTY_MAX_END;
      return;
    }

    const open: IndexedComment[] = [];
    for (const comment of comments) {
      if (comment.status !== "open") continue;
      open.push({
        start: comment.anchor.range.start,
        end: comment.anchor.range.end,
        comment,
      });
    }
    if (open.length === 0) {
      this.sorted = EMPTY_INDEX_SENTINEL;
      this.maxEndUpTo = EMPTY_MAX_END;
      return;
    }

    open.sort((a, b) => a.start - b.start || a.end - b.end);

    const maxEndUpTo = new Uint32Array(open.length);
    let max = 0;
    for (let i = 0; i < open.length; i += 1) {
      const e = open[i].end;
      if (e > max) max = e;
      maxEndUpTo[i] = max;
    }

    this.sorted = open;
    this.maxEndUpTo = maxEndUpTo;
  }

  /** Number of open comments in the index. */
  get size(): number {
    return this.sorted.length;
  }

  /**
   * True iff at least one open comment overlaps `[start, end)`.
   * O(log n) — the only branch the renderer's per-line highlight
   * scan needs. Designed to short-circuit on the early-termination
   * test against `maxEndUpTo`.
   */
  anyOverlapping(start: number, end: number): boolean {
    const sorted = this.sorted;
    if (sorted.length === 0) return false;
    // Find the leftmost index `i` such that `sorted[i].start >= end`.
    // Entries `[0..i)` have `start < end`; among those, anyone with
    // `end > start` overlaps.
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid].start < end) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return false;
    return this.maxEndUpTo[lo - 1] > start;
  }

  /**
   * Collect all open comments overlapping `[start, end)`. Returns
   * a fresh array on each call (avoiding shared mutable state
   * across the renderer). Order is roughly source-position
   * descending; callers that need a specific order should sort.
   */
  overlapping(start: number, end: number): WorkspaceCommentThread[] {
    const sorted = this.sorted;
    const out: WorkspaceCommentThread[] = [];
    if (sorted.length === 0) return out;
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid].start < end) lo = mid + 1;
      else hi = mid;
    }
    // Scan backward. Stop the moment no remaining prefix can
    // possibly overlap — the augmented max-end is the witness.
    for (let i = lo - 1; i >= 0; i -= 1) {
      if (this.maxEndUpTo[i] <= start) break;
      const entry = sorted[i];
      if (entry.end > start) out.push(entry.comment);
    }
    return out;
  }
}

/**
 * Pure-function overlap test for callers that don't have an index
 * handy (snapshot exports, one-shot tests). Production hot paths
 * should use [`CommentRangeIndex`].
 */
export function rangeOverlapsAny(
  range: SourceRange,
  comments: readonly WorkspaceCommentThread[],
): boolean {
  for (const comment of comments) {
    if (comment.status !== "open") continue;
    if (
      range.start < comment.anchor.range.end
      && comment.anchor.range.start < range.end
    ) {
      return true;
    }
  }
  return false;
}
