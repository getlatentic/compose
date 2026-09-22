import { useEffect, useState } from "react";
import type { EditorView } from "@codemirror/view";

import { onEditorUpdate, treeAt } from "@latentic/live-markdown";

/** What the caret sits in: which formatting buttons look pressed. */
export interface CaretContext {
  bold: boolean;
  italic: boolean;
  code: boolean;
  link: boolean;
  heading: 1 | 2 | 3 | 4 | 5 | 6 | 0;
  bulletList: boolean;
  orderedList: boolean;
  taskList: boolean;
  blockquote: boolean;
}

export const EMPTY_CONTEXT: CaretContext = {
  bold: false,
  italic: false,
  code: false,
  link: false,
  heading: 0,
  bulletList: false,
  orderedList: false,
  taskList: false,
  blockquote: false,
};

export function caretContext(view: EditorView): CaretContext {
  const pos = view.state.selection.main.head;
  const tree = treeAt(view.state, pos);
  let node: { name: string; parent: typeof node } | null = tree.resolveInner(
    pos,
    1,
  ) as unknown as { name: string; parent: typeof node };
  const ctx: CaretContext = { ...EMPTY_CONTEXT };
  while (node) {
    const n = node.name;
    if (n === "StrongEmphasis") ctx.bold = true;
    else if (n === "Emphasis") ctx.italic = true;
    else if (n === "InlineCode") ctx.code = true;
    else if (n === "Link") ctx.link = true;
    else if (n === "BulletList") ctx.bulletList = true;
    else if (n === "OrderedList") ctx.orderedList = true;
    else if (n === "Task") ctx.taskList = true;
    else if (n === "Blockquote") ctx.blockquote = true;
    else if (n.startsWith("ATXHeading")) {
      const lvl = Number(n.slice("ATXHeading".length));
      if (lvl >= 1 && lvl <= 6) ctx.heading = lvl as CaretContext["heading"];
    }
    node = node.parent;
  }
  // A task item lives inside a BulletList; surface it as a task, not a bullet.
  if (ctx.taskList) ctx.bulletList = false;
  return ctx;
}

export function caretContextsEqual(a: CaretContext, b: CaretContext): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.code === b.code &&
    a.link === b.link &&
    a.heading === b.heading &&
    a.bulletList === b.bulletList &&
    a.orderedList === b.orderedList &&
    a.taskList === b.taskList &&
    a.blockquote === b.blockquote
  );
}

/**
 * Keep the toolbar's pressed states in sync with the caret, re-rendering
 * only when the *computed* caret context actually changes — typing inside
 * a paragraph produces an unchanged context, so React never re-renders
 * (react-scan-tuned; recomputing on CM's update cycle avoids rAF idle
 * wakeups).
 *
 * Subscribes via the editor's update bus, which survives `setState` — an
 * appended updateListener died on the first tab switch, freezing the
 * pressed states at the previous document's context (B stuck active).
 */
export function useCaretContext(view: EditorView | null): CaretContext {
  const [ctx, setCtx] = useState<CaretContext>(EMPTY_CONTEXT);
  useEffect(
    function trackCaretForToolbarPressedState() {
      if (!view) {
        setCtx(EMPTY_CONTEXT);
        return;
      }
      let current = EMPTY_CONTEXT;
      const refresh = () => {
        const next = caretContext(view);
        if (!caretContextsEqual(next, current)) {
          current = next;
          setCtx(next);
        }
      };
      refresh();
      return onEditorUpdate(view, (update) => {
        if (update.docChanged || update.selectionSet) refresh();
      });
    },
    [view],
  );
  return ctx;
}
