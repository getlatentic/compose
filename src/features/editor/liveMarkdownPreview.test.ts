import { describe, expect, it } from "vitest";
import {
  toLivePreviewCodeBlock,
  toLivePreviewInlineRanges,
  toLivePreviewLine,
} from "./liveMarkdownPreview";

describe("live markdown preview parser", () => {
  it("renders inactive heading source as heading metadata", () => {
    expect(toLivePreviewLine("## Workspace notes")).toEqual({
      depth: 2,
      kind: "heading",
      text: "Workspace notes",
    });
  });

  it("renders list and task lines without changing source text", () => {
    expect(toLivePreviewLine("- Read current note")).toEqual({
      checked: null,
      kind: "listItem",
      ordered: false,
      text: "Read current note",
    });
    expect(toLivePreviewLine("- [x] Attach context")).toEqual({
      checked: true,
      kind: "listItem",
      ordered: false,
      text: "Attach context",
    });
  });

  it("ignores plain paragraph lines so the editor remains editable source", () => {
    expect(toLivePreviewLine("plain paragraph")).toBeNull();
  });

  it("renders fenced code blocks as inactive code preview metadata", () => {
    expect(toLivePreviewCodeBlock(["```ts", "const value = 1;", "```"])).toEqual({
      code: "const value = 1;",
      kind: "codeBlock",
      language: "ts",
    });
  });

  it("identifies inline preview ranges without changing source text", () => {
    expect(toLivePreviewInlineRanges("Use **bold**, `code`, and [docs](https://x.test)."))
      .toEqual([
        {
          from: 6,
          kind: "bold",
          markerRanges: [
            [4, 6],
            [10, 12],
          ],
          to: 10,
        },
        {
          from: 15,
          kind: "inlineCode",
          markerRanges: [
            [14, 15],
            [19, 20],
          ],
          to: 19,
        },
        {
          from: 27,
          kind: "link",
          markerRanges: [
            [26, 27],
            [31, 48],
          ],
          to: 31,
        },
      ]);
  });
});

describe("what markdown the live preview refuses to style", () => {
  it("leaves markers inside inline code literal", () => {
    // Code spans are collected first and occupy their range precisely so that
    // `**not bold**` in a snippet stays as typed. Styling it would hide the
    // asterisks a reader is being shown on purpose.
    const ranges = toLivePreviewInlineRanges("Type `**not bold**` exactly.");
    expect(ranges.map((range) => range.kind)).toEqual(["inlineCode"]);
  });

  it("reads a double marker as bold, not as two italics", () => {
    const ranges = toLivePreviewInlineRanges("**strong**");
    expect(ranges.map((range) => range.kind)).toEqual(["bold"]);
  });

  it("styles a link's label and not its destination", () => {
    // The URL is the part the reader does not want to see. `from`/`to` cover
    // the label; the brackets and the destination are markers.
    const ranges = toLivePreviewInlineRanges("[docs](https://example.test)");
    expect(ranges).toHaveLength(1);
    expect("[docs](https://example.test)".slice(ranges[0].from, ranges[0].to)).toBe("docs");
  });

  it("returns ranges in the order they appear", () => {
    // They are applied as decorations left to right; out of order they overlap
    // and CodeMirror throws.
    const ranges = toLivePreviewInlineRanges("`a` then **b** then *c*");
    const starts = ranges.map((range) => range.from);
    expect([...starts].sort((x, y) => x - y)).toEqual(starts);
  });
});

describe("line kinds the preview recognises", () => {
  it("reads both ordered-list spellings", () => {
    for (const source of ["1. First", "1) First"]) {
      expect(toLivePreviewLine(source)).toEqual({
        checked: null,
        kind: "listItem",
        ordered: true,
        text: "First",
      });
    }
  });

  it("reads a task box in either case, and an empty one as unchecked", () => {
    const checkbox = (source: string) => {
      const line = toLivePreviewLine(source);
      expect(line?.kind).toBe("listItem");
      return line?.kind === "listItem" ? line.checked : undefined;
    };
    expect(checkbox("- [X] Done")).toBe(true);
    expect(checkbox("- [ ] Not done")).toBe(false);
    expect(checkbox("- Plain item")).toBeNull();
  });

  it("drops a closing hash run from a heading", () => {
    // `## Title ##` is ATX-closed; showing the trailing hashes as part of the
    // title is the bug this strips.
    expect(toLivePreviewLine("## Title ##")).toEqual({
      depth: 2,
      kind: "heading",
      text: "Title",
    });
  });

  it("reads a quote", () => {
    expect(toLivePreviewLine("> quoted")).toEqual({ kind: "quote", text: "quoted" });
  });

  it("is not fooled by a fence that never closes", () => {
    // A block needs an opener and a closer; one line cannot be both.
    expect(toLivePreviewCodeBlock(["```ts"])).toBeNull();
  });
});
