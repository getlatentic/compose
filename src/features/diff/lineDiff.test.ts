import { describe, expect, it } from "vitest";

import { computeUnifiedDiff, type DiffLine } from "./lineDiff";

/** Compact a hunk's lines to "<sign><text>" for readable assertions. */
function sigil(line: DiffLine): string {
  const mark = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
  return `${mark}${line.text}`;
}

function flat(before: string, after: string, context = 3): string[] {
  return computeUnifiedDiff(before, after, context).hunks.flatMap((hunk) => hunk.lines.map(sigil));
}

describe("computeUnifiedDiff", () => {
  it("reports no hunks for identical text", () => {
    const diff = computeUnifiedDiff("a\nb\nc", "a\nb\nc");
    expect(diff.hunks).toHaveLength(0);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
  });

  it("shows a single changed line in context", () => {
    const diff = computeUnifiedDiff("a\nb\nc", "a\nB\nc");
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(flat("a\nb\nc", "a\nB\nc")).toEqual([" a", "-b", "+B", " c"]);
  });

  it("treats create (empty before) as all additions", () => {
    const diff = computeUnifiedDiff("", "x\ny");
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(0);
    expect(flat("", "x\ny")).toEqual(["+x", "+y"]);
  });

  it("treats delete (empty after) as all removals", () => {
    const diff = computeUnifiedDiff("x\ny", "");
    expect(diff.removed).toBe(2);
    expect(diff.added).toBe(0);
    expect(flat("x\ny", "")).toEqual(["-x", "-y"]);
  });

  it("ignores a single trailing newline (no phantom blank line)", () => {
    expect(computeUnifiedDiff("a\nb\n", "a\nb\n").hunks).toHaveLength(0);
    expect(flat("a\nb\n", "a\nc\n")).toEqual([" a", "-b", "+c"]);
  });

  it("numbers before/after lines independently across an insertion", () => {
    const [hunk] = computeUnifiedDiff("a\nc", "a\nb\nc").hunks;
    expect(hunk.lines.map((l) => [sigil(l), l.beforeLine, l.afterLine])).toEqual([
      [" a", 1, 1],
      ["+b", null, 2],
      [" c", 2, 3],
    ]);
  });

  it("folds a large unchanged gap into separate hunks", () => {
    const before = ["top", ...Array.from({ length: 40 }, (_, i) => `line${i}`), "bottom"].join("\n");
    const after = ["TOP", ...Array.from({ length: 40 }, (_, i) => `line${i}`), "BOTTOM"].join("\n");
    const diff = computeUnifiedDiff(before, after, 3);
    // Two change regions (top + bottom), far enough apart to not merge.
    expect(diff.hunks).toHaveLength(2);
    // The second hunk folds away the unchanged middle.
    expect(diff.hunks[1].skippedBefore).toBeGreaterThan(0);
  });

  it("merges nearby changes into one hunk", () => {
    const before = "a\nb\nc\nd\ne";
    const after = "a\nB\nc\nD\ne";
    // Changes at lines 2 and 4 are within 2*context, so one hunk.
    expect(computeUnifiedDiff(before, after, 3).hunks).toHaveLength(1);
  });
});
