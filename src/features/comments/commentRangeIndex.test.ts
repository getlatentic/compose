import { describe, expect, it } from "vitest";

import { CommentRangeIndex, rangeOverlapsAny } from "./commentRangeIndex";
import type {
  CommentAnchor,
  WorkspaceCommentThread,
} from "./commentModel";

function comment(
  id: string,
  start: number,
  end: number,
  status: "open" | "resolved" = "open",
): WorkspaceCommentThread {
  const anchor: CommentAnchor = {
    prefix: "",
    range: { start, end },
    resolution: "resolved",
    selectedText: "",
    suffix: "",
  };
  return {
    anchor,
    body: id,
    createdAt: 0,
    filePath: "test.md",
    id,
    status,
    updatedAt: 0,
  };
}

describe("CommentRangeIndex", () => {
  it("empty index never reports overlap", () => {
    const index = new CommentRangeIndex([]);
    expect(index.size).toBe(0);
    expect(index.anyOverlapping(0, 100)).toBe(false);
    expect(index.overlapping(0, 100)).toEqual([]);
  });

  it("filters out closed comments at construction", () => {
    const index = new CommentRangeIndex([
      comment("a", 0, 10),
      comment("b", 20, 30, "resolved"),
      comment("c", 40, 50),
    ]);
    expect(index.size).toBe(2); // closed 'b' excluded
  });

  it("anyOverlapping returns true for a strictly contained query", () => {
    const index = new CommentRangeIndex([comment("a", 10, 20)]);
    expect(index.anyOverlapping(12, 15)).toBe(true);
  });

  it("anyOverlapping handles touching ranges as half-open (non-overlap)", () => {
    // Comment [10,20). Query starting at 20 must NOT overlap.
    const index = new CommentRangeIndex([comment("a", 10, 20)]);
    expect(index.anyOverlapping(20, 30)).toBe(false);
    // Query ending at 10 must NOT overlap.
    expect(index.anyOverlapping(0, 10)).toBe(false);
  });

  it("overlapping returns every match", () => {
    // Query is [4, 8). Half-open: [start, end) overlap iff
    // start < other.end AND other.start < end.
    // a [0,5)   shares byte 4         → overlaps
    // b [3,10)  shares bytes 4..8     → overlaps
    // c [7,12)  shares byte 7         → overlaps
    // d [100,110) far away            → no
    const index = new CommentRangeIndex([
      comment("a", 0, 5),
      comment("b", 3, 10),
      comment("c", 7, 12),
      comment("d", 100, 110),
    ]);
    const hits = index.overlapping(4, 8).map((c) => c.id).sort();
    expect(hits).toEqual(["a", "b", "c"]);
  });

  it("overlapping scales — finds the few hits in a 1000-comment index", () => {
    const comments: WorkspaceCommentThread[] = [];
    for (let i = 0; i < 1000; i += 1) {
      comments.push(comment(`c${i}`, i * 100, i * 100 + 20));
    }
    const index = new CommentRangeIndex(comments);
    // Query that should hit comment 50 only.
    const hits = index.overlapping(5005, 5010);
    expect(hits.map((c) => c.id)).toEqual(["c50"]);
  });

  it("rebuilding after closing a comment removes it from the index", () => {
    const open = comment("a", 0, 10);
    const closed = { ...open, status: "resolved" as const };
    const indexAfter = new CommentRangeIndex([closed]);
    expect(indexAfter.size).toBe(0);
    expect(indexAfter.anyOverlapping(0, 5)).toBe(false);
  });

  it("rangeOverlapsAny pure helper agrees with the index for small inputs", () => {
    const comments = [
      comment("a", 0, 10),
      comment("b", 20, 30, "resolved"),
      comment("c", 40, 50),
    ];
    const index = new CommentRangeIndex(comments);
    const ranges = [
      [0, 5],
      [10, 20],
      [40, 45],
      [60, 70],
    ] as const;
    for (const [s, e] of ranges) {
      expect(rangeOverlapsAny({ start: s, end: e }, comments)).toBe(
        index.anyOverlapping(s, e),
      );
    }
  });
});
