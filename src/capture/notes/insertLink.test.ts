// @vitest-environment jsdom
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { insertLink } from "./insertLink";

// Destroyed after each test: a live view measures itself on the next frame,
// which jsdom cannot do.
const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((view) => view.destroy()));

function editor(doc: string, from: number, to = from): EditorView {
  const view = new EditorView({ state: EditorState.create({ doc, selection: EditorSelection.range(from, to) }) });
  views.push(view);
  return view;
}

describe("making a link", () => {
  it("links the selected words, with the caret after the link", () => {
    const view = editor("Read the guide today", 9, 14);
    insertLink(view, "https://example.com/guide");
    expect(view.state.doc.toString()).toBe("Read the [guide](https://example.com/guide) today");
    expect(view.state.selection.main.head).toBe("Read the [guide](https://example.com/guide)".length);
  });

  it("puts the address itself at the caret when nothing is selected", () => {
    const view = editor("See ", 4);
    insertLink(view, "https://example.com");
    expect(view.state.doc.toString()).toBe("See [https://example.com](https://example.com)");
  });

  it("keeps brackets in the text and spaces in the address from breaking the link", () => {
    const view = editor("[draft] notes", 0, 7);
    insertLink(view, "https://example.com/a b");
    expect(view.state.doc.toString()).toBe("[\\[draft\\]](https://example.com/a%20b) notes");
  });
});
