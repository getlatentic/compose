import { describe, expect, it } from "vitest";
import {
  applyDocumentChangesToComments,
  byteLength,
  codeUnitIndexToByteOffset,
  createCommentThread,
  sliceByByteRange,
  transformRange,
  type WorkspaceCommentThread,
} from "./commentModel";

function commentAt(range: { start: number; end: number }): WorkspaceCommentThread {
  return createCommentThread({
    body: "Tighten this claim",
    filePath: "notes/a.md",
    fullText: "Before **important** after",
    id: "comment-1",
    range,
    selectedText: "important",
    timestamp: 1,
  });
}

describe("comment model byte ranges", () => {
  it("converts browser input code-unit positions to UTF-8 byte offsets", () => {
    const text = "A 😀 café 中文";
    const selected = "café";
    const startCodeUnit = text.indexOf(selected);
    const endCodeUnit = startCodeUnit + selected.length;
    const range = {
      start: codeUnitIndexToByteOffset(text, startCodeUnit),
      end: codeUnitIndexToByteOffset(text, endCodeUnit),
    };

    expect(sliceByByteRange(text, range)).toBe("café");
    expect(range.start).toBe(byteLength("A 😀 "));
    expect(range.end).toBe(byteLength("A 😀 café"));
  });

  it("stores selected text and surrounding source context without writing to Markdown", () => {
    const text = "# Note\n\nThis is **important** context.";
    const selected = "important";
    const start = codeUnitIndexToByteOffset(text, text.indexOf(selected));
    const end = start + byteLength(selected);

    const comment = createCommentThread({
      body: "Check evidence",
      filePath: "note.md",
      fullText: text,
      id: "comment-1",
      range: { start, end },
      selectedText: selected,
      timestamp: 100,
    });

    expect(comment.anchor.range).toEqual({ start, end });
    expect(comment.anchor.selectedText).toBe(selected);
    expect(comment.anchor.prefix).toContain("**");
    expect(comment.anchor.suffix).toContain("**");
  });
});

describe("comment anchor transforms", () => {
  it("moves an anchor when text is inserted before it", () => {
    expect(
      transformRange({ start: 10, end: 20 }, { range: { start: 4, end: 4 }, text: "😀" }),
    ).toEqual({
      range: { start: 14, end: 24 },
      resolution: "moved",
    });
  });

  it("expands an anchor when text is inserted inside it", () => {
    expect(
      transformRange({ start: 10, end: 20 }, { range: { start: 14, end: 14 }, text: "new" }),
    ).toEqual({
      range: { start: 10, end: 23 },
      resolution: "expanded",
    });
  });

  it("contracts an anchor when text is deleted inside it", () => {
    expect(
      transformRange({ start: 10, end: 30 }, { range: { start: 14, end: 20 }, text: "" }),
    ).toEqual({
      range: { start: 10, end: 24 },
      resolution: "contracted",
    });
  });

  it("marks an anchor orphaned when the whole selected range is deleted", () => {
    expect(
      transformRange({ start: 10, end: 20 }, { range: { start: 8, end: 22 }, text: "" }),
    ).toEqual({
      range: null,
      resolution: "orphaned",
    });
  });

  it("replaces an anchor when replacement covers the selected range", () => {
    expect(
      transformRange({ start: 10, end: 20 }, { range: { start: 8, end: 22 }, text: "fixed" }),
    ).toEqual({
      range: { start: 8, end: 13 },
      resolution: "replaced",
    });
  });

  it("creates comments in bulk across a 100KB document with correct anchors", () => {
    // The hard perf gate for bulk comment creation lives in the lag
    // benchmark now (`commentCreate100` / `commentCreate1000` in
    // src/features/benchmark/commentOperations.ts) — that is where the
    // quadratic-by-allocation regression which once made a 1000-comment
    // / 500KB setup take ~18 minutes would show up, without a flaky
    // wall-clock assertion in the unit suite. This test keeps the
    // correctness half: anchors built in bulk must land on the right
    // bytes and carry the right selected text.
    const paragraph =
      "Paragraph with **bold**, *italic*, `code`, and a [link](https://example.com).\n";
    const fullText = paragraph.repeat(Math.ceil((100 * 1024) / paragraph.length));
    expect(fullText.length).toBeGreaterThanOrEqual(100 * 1024);

    const stride = Math.floor(fullText.length / 100);
    const comments: WorkspaceCommentThread[] = [];
    for (let i = 0; i < 100; i += 1) {
      const start = i * stride;
      const end = start + 16;
      comments.push(
        createCommentThread({
          body: `comment ${i}`,
          filePath: "perf.md",
          fullText,
          id: `comment-${i}`,
          range: { start, end },
          selectedText: fullText.slice(start, end),
          timestamp: 1,
        }),
      );
    }

    expect(comments).toHaveLength(100);
    for (let i = 0; i < comments.length; i += 1) {
      const start = i * stride;
      expect(comments[i].anchor.range).toEqual({ start, end: start + 16 });
      expect(comments[i].anchor.selectedText).toBe(fullText.slice(start, start + 16));
    }
  });

  it("updates only comments attached to the edited file", () => {
    const comment = commentAt({ start: 9, end: 18 });
    const other = { ...comment, id: "comment-2", filePath: "notes/b.md" };

    const comments = applyDocumentChangesToComments(
      [comment, other],
      "notes/a.md",
      [{ range: { start: 0, end: 0 }, text: "Intro " }],
      200,
    );

    expect(comments[0].anchor.range).toEqual({ start: 15, end: 24 });
    expect(comments[0].updatedAt).toBe(200);
    expect(comments[1]).toBe(other);
  });
});
