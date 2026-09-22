import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

/**
 * Make the selection a link to `url`, or put the link at the caret when nothing
 * is selected, with its address as its text. The caret ends after the link.
 */
export function insertLink(view: EditorView, url: string): void {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to) || url;
  const link = `[${text.replace(/[[\]]/g, "\\$&")}](${linkAddress(url)})`;
  view.dispatch({
    changes: { from, to, insert: link },
    selection: EditorSelection.cursor(from + link.length),
    scrollIntoView: true,
  });
}

/** An address that cannot end a Markdown link early: its parentheses and spaces escaped. */
export function linkAddress(url: string): string {
  return url.replace(/[()\s]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}
