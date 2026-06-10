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
