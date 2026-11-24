import { blockKeys, changeBlocks, type ChangeBlock } from "./changeBlocks";
import { wordDiff, type WordSegment } from "./wordDiff";

/**
 * One edit the agent made, the unit the writer keeps or undoes: a run of
 * changed words between words it left alone, or a whole block of lines when
 * the lines themselves were added, removed or split.
 */
export interface AgentEdit {
  /** Stable across the note moving around it: its block's key and its place in the block. */
  readonly key: string;
  /** The words before the change (`""` for an insertion). */
  readonly removed: string;
  /** The words after it (`""` for a deletion). */
  readonly added: string;
  /** The unchanged words just before it on its line, to say where it is. */
  readonly before: string;
}

/** A word-level edit's place in its line's word diff. */
interface WordEdit extends AgentEdit {
  readonly kind: "words";
  readonly line: number;
  /** Index of its first segment in that line's segments. */
  readonly segment: number;
  /** How many segments (one or two: removed and/or added) it spans. */
  readonly segmentCount: number;
}

/** An edit that is its block's whole run of lines. */
interface LinesEdit extends AgentEdit {
  readonly kind: "lines";
}

export type BlockEdit = WordEdit | LinesEdit;

/** A changed block of the agent's diff, split into the edits a writer decides. */
export interface AgentBlock {
  readonly key: string;
  readonly block: ChangeBlock;
  /** Per line pair, its word diff; null when the block is one `lines` edit. */
  readonly lines: readonly (readonly WordSegment[])[] | null;
  readonly edits: readonly BlockEdit[];
}

const BLANK = /^\s*$/;

function editKey(blockKey: string, index: number): string {
  return `${blockKey}\u0001${index}`;
}

/**
 * The word edits of one line: each maximal run of removed/added segments.
 * A run of only whitespace is not offered: it has nothing to show, and it
 * stays as the run left it.
 */
function lineEdits(blockKey: string, line: number, segments: readonly WordSegment[], first: number): WordEdit[] {
  const edits: WordEdit[] = [];
  let index = 0;
  let before = "";
  while (index < segments.length) {
    if (segments[index].kind === "same") {
      before = segments[index].text;
      index += 1;
      continue;
    }
    const start = index;
    let removed = "";
    let added = "";
    while (index < segments.length && segments[index].kind !== "same") {
      if (segments[index].kind === "removed") removed += segments[index].text;
      else added += segments[index].text;
      index += 1;
    }
    if (BLANK.test(removed) && BLANK.test(added)) continue;
    edits.push({
      kind: "words",
      key: editKey(blockKey, first + edits.length),
      removed,
      added,
      before,
      line,
      segment: start,
      segmentCount: index - start,
    });
  }
  return edits;
}

function splitBlock(key: string, block: ChangeBlock): AgentBlock {
  const paired = block.removed.length > 0 && block.removed.length === block.added.length;
  if (paired) {
    const lines = block.removed.map((line, index) => wordDiff(line, block.added[index]));
    const edits: WordEdit[] = [];
    lines.forEach((segments, line) => edits.push(...lineEdits(key, line, segments, edits.length)));
    if (edits.length > 0) return { key, block, lines, edits };
  }
  const whole: LinesEdit = {
    kind: "lines",
    key: editKey(key, 0),
    removed: block.removed.join("\n"),
    added: block.added.join("\n"),
    before: "",
  };
  return { key, block, lines: null, edits: [whole] };
}

/** The agent's change from `original` to `proposed`, as blocks of decidable edits. */
export function agentBlocks(original: string, proposed: string): AgentBlock[] {
  const blocks = changeBlocks(original, proposed);
  const keys = blockKeys(blocks);
  return blocks.map((block, index) => splitBlock(keys[index], block));
}

/** Every edit's key, for recording a decision against and for knowing when all are decided. */
export function agentEditKeys(original: string, proposed: string): string[] {
  return agentBlocks(original, proposed).flatMap((block) => block.edits.map((edit) => edit.key));
}
