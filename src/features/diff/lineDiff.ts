/**
 * Line-level unified diff for the in-chat change preview. Turns a
 * before/after pair into hunks of added / removed / context lines, with
 * long unchanged regions folded to a count — so the reader sees *what
 * changed*, not two full copies of the file to eyeball (the side-by-side
 * this replaced made a one-line edit in a 500-line file invisible).
 *
 * This runs once per file change in a post-run review — never in a
 * per-keystroke loop — so a straightforward LCS is the right tool. The
 * O(n·m) table is bounded two ways: common head/tail lines are trimmed
 * first (most edits touch a small region, collapsing the LCS to almost
 * nothing), and a hard cell cap falls back to a coarse whole-block
 * replace so a pathological input can't blow memory.
 */

export type DiffLineKind = "add" | "remove" | "context";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  /** 1-based line number in the *before* text, or null for an added line. */
  beforeLine: number | null;
  /** 1-based line number in the *after* text, or null for a removed line. */
  afterLine: number | null;
}

/** A contiguous run of changed lines plus their surrounding context. */
export interface DiffHunk {
  lines: DiffLine[];
  /** Count of unchanged lines folded away immediately before this hunk. */
  skippedBefore: number;
}

export interface UnifiedDiff {
  hunks: DiffHunk[];
  added: number;
  removed: number;
  /** True when the LCS was skipped for a coarse replace (huge input). */
  truncated: boolean;
}

/** ~2000×2000 lines. Above this the LCS table is skipped (see module doc). */
const MAX_LCS_CELLS = 4_000_000;
const DEFAULT_CONTEXT = 3;

interface Op {
  kind: DiffLineKind;
  text: string;
  beforeLine: number | null;
  afterLine: number | null;
}

/**
 * Split into lines for diffing, dropping a single trailing newline so a
 * file ending in "\n" doesn't show a phantom empty last line. An empty
 * string is zero lines (not one empty line).
 */
function splitLines(text: string): string[] {
  if (text === "") return [];
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n");
}

/**
 * LCS over the *trimmed middle* (offset = number of common prefix lines,
 * used only to label line numbers). Fills a flat table bottom-up, then
 * backtracks top-down so equal/remove/add come out in document order.
 */
function lcsOps(before: string[], after: string[], offset: number): Op[] {
  const n = before.length;
  const m = after.length;
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      if (before[i] === after[j]) {
        dp[i * width + j] = dp[(i + 1) * width + (j + 1)] + 1;
      } else {
        const down = dp[(i + 1) * width + j];
        const right = dp[i * width + (j + 1)];
        dp[i * width + j] = down >= right ? down : right;
      }
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  let bLine = offset + 1;
  let aLine = offset + 1;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ kind: "context", text: before[i], beforeLine: bLine, afterLine: aLine });
      i += 1;
      j += 1;
      bLine += 1;
      aLine += 1;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + (j + 1)]) {
      ops.push({ kind: "remove", text: before[i], beforeLine: bLine, afterLine: null });
      i += 1;
      bLine += 1;
    } else {
      ops.push({ kind: "add", text: after[j], beforeLine: null, afterLine: aLine });
      j += 1;
      aLine += 1;
    }
  }
  while (i < n) {
    ops.push({ kind: "remove", text: before[i], beforeLine: bLine, afterLine: null });
    i += 1;
    bLine += 1;
  }
  while (j < m) {
    ops.push({ kind: "add", text: after[j], beforeLine: null, afterLine: aLine });
    j += 1;
    aLine += 1;
  }
  return ops;
}

/** Full ordered op list over both files, with the LCS bounded as above. */
function computeOps(before: string[], after: string[]): { ops: Op[]; truncated: boolean } {
  const n = before.length;
  const m = after.length;

  let lo = 0;
  while (lo < n && lo < m && before[lo] === after[lo]) lo += 1;
  let hiB = n;
  let hiA = m;
  while (hiB > lo && hiA > lo && before[hiB - 1] === after[hiA - 1]) {
    hiB -= 1;
    hiA -= 1;
  }

  const ops: Op[] = [];
  for (let i = 0; i < lo; i += 1) {
    ops.push({ kind: "context", text: before[i], beforeLine: i + 1, afterLine: i + 1 });
  }

  const midBefore = before.slice(lo, hiB);
  const midAfter = after.slice(lo, hiA);
  let truncated = false;

  if (midBefore.length === 0) {
    for (let j = 0; j < midAfter.length; j += 1) {
      ops.push({ kind: "add", text: midAfter[j], beforeLine: null, afterLine: lo + j + 1 });
    }
  } else if (midAfter.length === 0) {
    for (let i = 0; i < midBefore.length; i += 1) {
      ops.push({ kind: "remove", text: midBefore[i], beforeLine: lo + i + 1, afterLine: null });
    }
  } else if (midBefore.length * midAfter.length > MAX_LCS_CELLS) {
    // Pathological input: skip the LCS, show the whole middle as a
    // remove-then-add block. Flagged so the UI can say so.
    truncated = true;
    for (let i = 0; i < midBefore.length; i += 1) {
      ops.push({ kind: "remove", text: midBefore[i], beforeLine: lo + i + 1, afterLine: null });
    }
    for (let j = 0; j < midAfter.length; j += 1) {
      ops.push({ kind: "add", text: midAfter[j], beforeLine: null, afterLine: lo + j + 1 });
    }
  } else {
    ops.push(...lcsOps(midBefore, midAfter, lo));
  }

  for (let i = hiB; i < n; i += 1) {
    const afterIdx = hiA + (i - hiB);
    ops.push({ kind: "context", text: before[i], beforeLine: i + 1, afterLine: afterIdx + 1 });
  }

  return { ops, truncated };
}

/**
 * Group the op stream into hunks: each changed line, padded by `context`
 * unchanged lines on each side, with adjacent/overlapping pads merged.
 * The unchanged lines between hunks are folded — their count rides on the
 * next hunk's `skippedBefore`.
 */
function segmentHunks(ops: Op[], context: number): DiffHunk[] {
  const ranges: Array<{ start: number; end: number }> = [];
  for (let k = 0; k < ops.length; k += 1) {
    if (ops[k].kind === "context") continue;
    const start = Math.max(0, k - context);
    const end = Math.min(ops.length - 1, k + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  const hunks: DiffHunk[] = [];
  let prevEnd = -1;
  for (const range of ranges) {
    const lines: DiffLine[] = [];
    for (let k = range.start; k <= range.end; k += 1) {
      lines.push({
        kind: ops[k].kind,
        text: ops[k].text,
        beforeLine: ops[k].beforeLine,
        afterLine: ops[k].afterLine,
      });
    }
    hunks.push({ lines, skippedBefore: range.start - (prevEnd + 1) });
    prevEnd = range.end;
  }
  return hunks;
}

export function computeUnifiedDiff(
  before: string,
  after: string,
  context: number = DEFAULT_CONTEXT,
): UnifiedDiff {
  const { ops, truncated } = computeOps(splitLines(before), splitLines(after));
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.kind === "add") added += 1;
    else if (op.kind === "remove") removed += 1;
  }
  return { hunks: segmentHunks(ops, context), added, removed, truncated };
}
