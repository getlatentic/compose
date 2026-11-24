/**
 * Word-level diff of one changed line, for the marks drawn in the note: the
 * words a change took out (struck through) and put in (underlined), with the
 * words it kept left plain.
 */

export type WordSegmentKind = "same" | "removed" | "added";

export interface WordSegment {
  readonly kind: WordSegmentKind;
  readonly text: string;
}

/** Above this many token pairs the line is shown as wholly replaced. */
const MAX_CELLS = 250_000;

/** Words, runs of whitespace, and single punctuation marks. */
function tokens(text: string): string[] {
  return text.match(/\s+|[\p{L}\p{N}_'’-]+|[^\s]/gu) ?? [];
}

function push(segments: WordSegment[], kind: WordSegmentKind, text: string): void {
  const last = segments[segments.length - 1];
  if (last && last.kind === kind) {
    segments[segments.length - 1] = { kind, text: last.text + text };
  } else {
    segments.push({ kind, text });
  }
}

export function wordDiff(before: string, after: string): WordSegment[] {
  const a = tokens(before);
  const b = tokens(after);
  if (a.length * b.length > MAX_CELLS) {
    const whole: WordSegment[] = [];
    if (before) whole.push({ kind: "removed", text: before });
    if (after) whole.push({ kind: "added", text: after });
    return whole;
  }
  const width = b.length + 1;
  const table = new Int32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const segments: WordSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(segments, "same", a[i]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      push(segments, "removed", a[i]);
      i += 1;
    } else {
      push(segments, "added", b[j]);
      j += 1;
    }
  }
  for (; i < a.length; i += 1) push(segments, "removed", a[i]);
  for (; j < b.length; j += 1) push(segments, "added", b[j]);
  return groupChanges(segments);
}

/**
 * A space kept between two changed words belongs to the change, so "We
 * recruited them" reads as one struck phrase, not three struck words.
 */
function groupChanges(segments: readonly WordSegment[]): WordSegment[] {
  const out: WordSegment[] = [];
  let removed = "";
  let added = "";
  const flush = () => {
    if (removed) push(out, "removed", removed);
    if (added) push(out, "added", added);
    removed = "";
    added = "";
  };
  segments.forEach((segment, index) => {
    if (segment.kind === "removed") {
      removed += segment.text;
    } else if (segment.kind === "added") {
      added += segment.text;
    } else {
      const inRun = removed !== "" || added !== "";
      const nextChanges = index + 1 < segments.length && segments[index + 1].kind !== "same";
      if (inRun && nextChanges && /^\s+$/.test(segment.text)) {
        removed += segment.text;
        added += segment.text;
      } else {
        flush();
        push(out, "same", segment.text);
      }
    }
  });
  flush();
  return out;
}

/** Count of words (not spaces or punctuation) in a text. */
export function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}_'’-]+/gu)?.length ?? 0;
}
