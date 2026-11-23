// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { headingGap } from "./headingGap";

function shortLines(doc: string): string[] {
  const view = new EditorView({ state: EditorState.create({ doc, extensions: headingGap }), parent: document.body });
  const lines = [...view.contentDOM.querySelectorAll(".cm-line")];
  const result = lines.map((line, index) => (line.classList.contains("cm-after-heading") ? `${index + 1}` : "")).filter(Boolean);
  view.destroy();
  return result;
}

describe("headingGap", () => {
  it("shortens the blank line under a heading, and no other blank line", () => {
    expect(shortLines("# Title\n\nFirst paragraph.\n\nSecond paragraph.\n\n## Section\n\nText.")).toEqual(["2", "8"]);
  });

  it("leaves a line that only looks like a heading alone", () => {
    expect(shortLines("#hashtag\n\nText.")).toEqual([]);
  });
});
