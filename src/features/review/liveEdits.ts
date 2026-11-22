import { diffLines } from "../diff/lineDiff";
import { agentBlocks, type AgentBlock, type BlockEdit } from "./agentEdits";
import { lineSpan, lineStarts } from "./lineSpan";
import type { WordSegment } from "./wordDiff";

/**
 * - `applied`: the agent already wrote the file (the default). The note holds
 *   the new text; an edit can be kept or undone.
 * - `pending`: "Review changes before applying" is on. The note still holds
 *   the old text; an edit can be accepted or rejected.
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
  /** Edit keys whose new words are in the note: kept or accepted. */
  readonly kept: readonly string[];
  /** Edit keys whose old words are in the note: undone or rejected. */
  readonly dropped: readonly string[];
}

/** An undecided edit, found in the note as it is now. */
export interface LiveEdit {
  readonly reviewId: string;
  readonly key: string;
  readonly mode: ReviewMode;
  readonly agentName: string;
  /** Character range in the note of the edit's words as the note has them:
   *  the new words (applied) or the old (pending). Empty for an insertion point. */
  readonly from: number;
  readonly to: number;
  /** What replaces `from`–`to` to undo (applied) or accept (pending) it. */
  readonly replacement: string;
  /** The edit's old and new words, for its card and its marks. */
  readonly removed: string;
  readonly added: string;
  /** True when the edit is whole lines, drawn as a block rather than inline words. */
  readonly wholeLines: boolean;
}

type Side = "removed" | "added";

interface Decisions {
  readonly mode: ReviewMode;
  readonly kept: ReadonlySet<string>;
  readonly dropped: ReadonlySet<string>;
}

/** Which side of an edit the note holds: a decision's, or the run's own until decided. */
function sideOf(decisions: Decisions, key: string): Side {
  if (decisions.kept.has(key)) return "added";
  if (decisions.dropped.has(key)) return "removed";
  return decisions.mode === "applied" ? "added" : "removed";
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  return (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
}

/** For each line of `base` that the note still has unchanged, its line in the note. */
function unchangedLines(base: string, note: string): Map<number, number> {
  const map = new Map<number, number>();
  for (const line of diffLines(base, note).lines) {
    if (line.kind === "context" && line.beforeLine !== null && line.afterLine !== null) {
      map.set(line.beforeLine - 1, line.afterLine - 1);
    }
  }
  return map;
}

/** The segment index → offered edit, for a word-diffed line. */
function editsBySegment(edits: readonly BlockEdit[], line: number): Map<number, BlockEdit & { kind: "words" }> {
  const map = new Map<number, BlockEdit & { kind: "words" }>();
  for (const edit of edits) {
    if (edit.kind !== "words" || edit.line !== line) continue;
    for (let index = edit.segment; index < edit.segment + edit.segmentCount; index += 1) map.set(index, edit);
  }
  return map;
}

/** One line as the note should hold it, and where each undecided edit sits in it. */
function buildLine(
  segments: readonly WordSegment[],
  bySegment: Map<number, BlockEdit & { kind: "words" }>,
  decisions: Decisions,
): { text: string; spans: Map<string, { from: number; to: number; other: string }> } {
  const fallback: Side = decisions.mode === "applied" ? "added" : "removed";
  const spans = new Map<string, { from: number; to: number; other: string }>();
  let text = "";
  segments.forEach((segment, index) => {
    if (segment.kind === "same") {
      text += segment.text;
      return;
    }
    const edit = bySegment.get(index);
    const side = edit ? sideOf(decisions, edit.key) : fallback;
    const undecided = edit && !decisions.kept.has(edit.key) && !decisions.dropped.has(edit.key);
    if (undecided && !spans.has(edit.key)) spans.set(edit.key, { from: text.length, to: text.length, other: "" });
    const span = undecided ? spans.get(edit.key) : undefined;
    if (segment.kind === side) {
      text += segment.text;
      if (span) span.to = text.length;
    } else if (span) {
      span.other += segment.text;
    }
  });
  return { text, spans };
}

interface Region {
  readonly startLine: number;
  readonly lines: readonly string[];
}

/** The block's lines as the note should hold them, given the decisions so far. */
function expectedLines(agent: AgentBlock, decisions: Decisions): string[] {
  if (!agent.lines) {
    return sideOf(decisions, agent.edits[0].key) === "added" ? [...agent.block.added] : [...agent.block.removed];
  }
  return agent.lines.map((segments, line) => buildLine(segments, editsBySegment(agent.edits, line), decisions).text);
}

/**
 * Where the block is in the note: between the unchanged lines around it in
 * the run's fixed side, and holding exactly the lines the decisions imply.
 * Null when the writer has since edited it or the lines around it by hand.
 */
function findRegion(
  agent: AgentBlock,
  decisions: Decisions,
  baseLineCount: number,
  unchanged: Map<number, number>,
  noteLines: readonly string[],
): Region | null {
  const applied = decisions.mode === "applied";
  const first = applied ? agent.block.beforeLine : agent.block.afterLine;
  const count = applied ? agent.block.removed.length : agent.block.added.length;
  const startLine = first === 0 ? 0 : (unchanged.get(first - 1) ?? -2) + 1;
  const endLine = first + count === baseLineCount ? noteLines.length : (unchanged.get(first + count) ?? -1);
  if (startLine < 0 || endLine < startLine) return null;
  const expected = expectedLines(agent, decisions);
  const actual = noteLines.slice(startLine, endLine);
  if (actual.length !== expected.length || actual.some((line, index) => line !== expected[index])) return null;
  return { startLine, lines: expected };
}

function blockLiveEdits(
  review: FileReview,
  agent: AgentBlock,
  region: Region,
  decisions: Decisions,
  note: string,
  starts: readonly number[],
): LiveEdit[] {
  const undecided = agent.edits.filter((edit) => !decisions.kept.has(edit.key) && !decisions.dropped.has(edit.key));
  const base = { reviewId: review.id, mode: review.mode, agentName: review.agentName };
  if (!agent.lines) {
    return undecided.map((edit) => {
      const other = review.mode === "applied" ? agent.block.removed : agent.block.added;
      const span = lineSpan(note, starts, region.startLine, region.lines.length, other);
      return { ...base, key: edit.key, ...span, removed: edit.removed, added: edit.added, wholeLines: true };
    });
  }
  const found: LiveEdit[] = [];
  agent.lines.forEach((segments, line) => {
    const { spans } = buildLine(segments, editsBySegment(agent.edits, line), decisions);
    const lineStart = starts[region.startLine + line];
    for (const edit of undecided) {
      const span = spans.get(edit.key);
      if (!span) continue;
      found.push({
        ...base,
        key: edit.key,
        from: lineStart + span.from,
        to: lineStart + span.to,
        replacement: span.other,
        removed: edit.removed,
        added: edit.added,
        wholeLines: false,
      });
    }
  });
  return found;
}

/**
 * The review's undecided edits that are still in the note, with their
 * current position. An edit the writer has rewritten by hand, or whose
 * surrounding lines they changed, drops out of review instead of offering a
 * stale swap; the writer's own changes elsewhere never show as the agent's.
 */
export function liveEdits(review: FileReview, note: string): LiveEdit[] {
  const decisions: Decisions = { mode: review.mode, kept: new Set(review.kept), dropped: new Set(review.dropped) };
  const agents = agentBlocks(review.original, review.proposed).filter((agent) =>
    agent.edits.some((edit) => !decisions.kept.has(edit.key) && !decisions.dropped.has(edit.key)),
  );
  if (agents.length === 0) return [];
  const base = review.mode === "applied" ? review.original : review.proposed;
  const unchanged = unchangedLines(base, note);
  const baseLineCount = splitLines(base).length;
  const noteLines = splitLines(note);
  const starts = lineStarts(note);
  return agents.flatMap((agent) => {
    const region = findRegion(agent, decisions, baseLineCount, unchanged, noteLines);
    return region ? blockLiveEdits(review, agent, region, decisions, note, starts) : [];
  });
}

/** Unique across reviews: two runs can make the same edit. */
export function editId(edit: Pick<LiveEdit, "reviewId" | "key">): string {
  return `${edit.reviewId}\n${edit.key}`;
}

/** Undecided edits of every review on the note, in document order. */
export function allLiveEdits(reviews: readonly FileReview[], note: string): LiveEdit[] {
  return reviews.flatMap((review) => liveEdits(review, note)).sort((a, b) => a.from - b.from);
}
