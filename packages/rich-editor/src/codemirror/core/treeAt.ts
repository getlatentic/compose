import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/**
 * How long a structural lookup may spend parsing. It runs inside a keystroke,
 * so this is a budget rather than a guarantee: past it we answer from whatever
 * has been parsed, exactly as before.
 */
const PARSE_BUDGET_MS = 50;

/**
 * A syntax tree that reaches `pos`.
 *
 * `syntaxTree` returns only what the **viewport** has driven the parser
 * through, so `resolveInner` past that point reports the position as bare
 * `Document`. Every command that asks "am I inside a list / a fence / a table?"
 * then gets "no" and takes the plain-text path: a wrong answer, not a slow one.
 *
 * Measured in WebKit, the engine we ship on, with real layout: on the frame a
 * 7,902-character document opens, the parser has covered 3,009 characters and
 * the viewport is 0–331 — for an editor 11,404px tall. CodeMirror's background
 * parse walks past the viewport during idle and covers the rest within about a
 * second and a half, which is why the wrong answer survives hand-testing and
 * why `treeAt.browser.test.ts` runs the commands on the opening frame.
 *
 * Only for questions about a *position*. Decoration plugins iterate
 * `view.visibleRanges` and should keep using `syntaxTree` directly: there,
 * being limited to the viewport is the point.
 */
export function treeAt(state: EditorState, pos: number) {
  return ensureSyntaxTree(state, pos + 1, PARSE_BUDGET_MS) ?? syntaxTree(state);
}
