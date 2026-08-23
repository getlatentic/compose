/**
 * Real-WebKit proof that a viewport-limited tree is a production condition, not
 * a jsdom artifact — the reason {@link treeAt} exists.
 *
 * Measured in this engine on a 7,902-character document (editor 11,404px tall,
 * real layout): on the frame the view opens, the parser has covered 3,009
 * characters and the viewport is 0–331. CodeMirror's background parse then
 * walks past the viewport during idle and covers the rest within ~1.5s.
 *
 * So the wrong answer is a race, not a permanent state, which is exactly why it
 * survives hand-testing: by the time a human has clicked into the document it
 * has healed. These cases run the command on the opening frame, where a
 * `syntaxTree` read still answers "no fence here" and the guard lets a delete
 * cross a boundary it should have walled.
 *
 * The jsdom suites pin the same moment permanently — no layout means no viewport
 * growth and no idle parse work — which is what made them flaky before the fix.
 */

import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { markdownDecorationsPlugin } from "./plugin";
import { tightListContinuation } from "../list/listContinuation";
import { visibleBackspace } from "../interaction/deleteNormalizer";

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) {
    view.destroy();
    view.dom.parentElement?.remove();
  }
});

/**
 * An editor built the way the app builds one — no pre-parse. The harness's
 * `makeEditor` drives the parse to the end of the document first, which is the
 * one thing that would hide what these cases are about.
 */
function openEditor(doc: string, caret: number): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(caret),
      extensions: [markdown({ base: markdownLanguage }), markdownDecorationsPlugin],
    }),
  });
  views.push(view);
  return view;
}

/** Paragraphs enough to put `tail` past the opening frame's parsed region. */
function belowTheFold(tail: string) {
  const filler = Array.from({ length: 400 }, (_, i) => `paragraph line ${i}`).join("\n\n");
  return `${filler}\n\n${tail}`;
}

/**
 * The premise, asserted rather than assumed: on this frame the parser really
 * has stopped short of the caret. A failure here means CodeMirror now covers
 * the document up front and these cases have stopped testing anything — the
 * test needs revisiting, not the editor.
 */
function expectParseStopsShortOf(view: EditorView, caret: number) {
  expect(syntaxTree(view.state).length).toBeLessThan(caret);
}

describe("structural lookups on the frame the document opens", () => {
  it("walls a fence that the parser has not reached yet", () => {
    const doc = belowTheFold("```\ncode\n```");
    const caret = doc.lastIndexOf("code");
    const view = openEditor(doc, caret);

    expectParseStopsShortOf(view, caret);
    expect(visibleBackspace(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("continues a list the parser has not reached yet", () => {
    const doc = belowTheFold("- item");
    const caret = doc.length;
    const view = openEditor(doc, caret);

    expectParseStopsShortOf(view, caret);
    expect(tightListContinuation(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(`${doc}\n- `);
  });
});
