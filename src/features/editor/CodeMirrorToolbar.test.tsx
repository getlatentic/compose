// @vitest-environment jsdom
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import {
  caretContext,
  caretContextsEqual,
  EMPTY_CONTEXT,
  type CaretContext,
} from "./CodeMirrorToolbar";

/** A headless editor with the caret at `caret`, parsed before it is read. */
function editorAt(doc: string, caret: number): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(caret),
    extensions: [markdown({ base: markdownLanguage })],
  });
  if (ensureSyntaxTree(state, doc.length, 5000) === null) {
    throw new Error("the markdown parse did not finish; the context would be read from no tree");
  }
  return new EditorView({ state });
}

describe("which toolbar buttons look pressed", () => {
  it("compares every field it has", () => {
    // The memo gate: an unequal context is what makes the toolbar re-render.
    // A field added later and not compared freezes that button's pressed state
    // at the previous caret's value — which is the "B stuck active" bug the
    // implementation comment already records having happened once.
    for (const key of Object.keys(EMPTY_CONTEXT) as Array<keyof CaretContext>) {
      const changed: CaretContext = { ...EMPTY_CONTEXT };
      if (key === "heading") {
        changed.heading = 3;
      } else {
        (changed[key] as boolean) = !EMPTY_CONTEXT[key];
      }
      expect(
        caretContextsEqual(EMPTY_CONTEXT, changed),
        `${key} is not compared, so the toolbar will not re-render when it changes`,
      ).toBe(false);
    }
  });

  it("says two identical contexts are identical", () => {
    // The other direction: over-reporting change re-renders the toolbar on
    // every keystroke inside a paragraph, which is what the memo exists to stop.
    expect(caretContextsEqual({ ...EMPTY_CONTEXT }, { ...EMPTY_CONTEXT })).toBe(true);
  });
});

describe("reading the caret's context from the document", () => {
  it("reports a task as a task and not as a bullet", () => {
    // A task item is a BulletList child in the tree, so without the override
    // both buttons light up and the user cannot tell which list they are in.
    const doc = "- [ ] a task";
    const ctx = caretContext(editorAt(doc, doc.indexOf("task")));
    expect(ctx.taskList).toBe(true);
    expect(ctx.bulletList).toBe(false);
  });

  it("still reports a plain bullet as a bullet", () => {
    const doc = "- plain item";
    const ctx = caretContext(editorAt(doc, doc.indexOf("plain")));
    expect(ctx.bulletList).toBe(true);
    expect(ctx.taskList).toBe(false);
  });

  it("reads the heading level, not just that it is a heading", () => {
    // The level picks which heading entry is checked in the menu.
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const doc = `${"#".repeat(level)} Title`;
      expect(caretContext(editorAt(doc, doc.indexOf("Title"))).heading).toBe(level);
    }
    expect(caretContext(editorAt("plain text", 2)).heading).toBe(0);
  });

  it("reads inline marks around the caret", () => {
    const bold = "some **strong** text";
    expect(caretContext(editorAt(bold, bold.indexOf("strong"))).bold).toBe(true);

    const code = "some `snippet` text";
    expect(caretContext(editorAt(code, code.indexOf("snippet"))).code).toBe(true);

    const quote = "> quoted";
    expect(caretContext(editorAt(quote, quote.indexOf("quoted"))).blockquote).toBe(true);
  });

  it("reports nothing for plain prose", () => {
    expect(caretContext(editorAt("just words", 4))).toEqual(EMPTY_CONTEXT);
  });
});

describe("caret context below the fold", () => {
  it("reports bold for a caret the viewport-driven parse never reached", () => {
    const filler = Array.from({ length: 400 }, (_, i) => `paragraph line ${i}`).join("\n\n");
    const doc = `${filler}\n\n**hello**`;
    const ctx = caretContext(editorAt(doc, doc.length - 4));
    expect(ctx.bold).toBe(true);
  });
});
