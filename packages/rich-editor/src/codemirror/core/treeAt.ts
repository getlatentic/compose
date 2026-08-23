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
 * through — measured at 3,009 characters of a 62,000-character document — so
 * `resolveInner` past that point reports the position as bare `Document`. Every
 * command that asks "am I inside a list / a fence / a table?" then gets "no"
 * and takes the plain-text path: a wrong answer, not a slow one.
 *
 * It is also what made the editor suites flaky. jsdom has no layout, so a view
 * reports a viewport of a few hundred characters whatever the document holds,
 * and whether the parse happened to reach the caret came down to timing under
 * load — which is why those tests passed alone and failed in a full run.
 *
 * Only for questions about a *position*. Decoration plugins iterate
 * `view.visibleRanges` and should keep using `syntaxTree` directly: there,
 * being limited to the viewport is the point.
 */
export function treeAt(state: EditorState, pos: number) {
  return ensureSyntaxTree(state, pos + 1, PARSE_BUDGET_MS) ?? syntaxTree(state);
}
