import { Extension } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { parseWikilinkBody } from "../../lib/links/wikilink";

/**
 * Decorate `[[Note]]` / `[[Note|alias]]` spans so they read as — and click
 * like — links, **without changing the document model**: the text stays the
 * literal `[[…]]`, so it round-trips through markdown byte-for-byte (no custom
 * node, no custom serializer, no escaping risk). The decoration only adds a
 * class + a `data-wikilink-target` attribute; resolution + navigation happen on
 * click in `TiptapMarkdownEditor`, which has the workspace file list.
 *
 * Perf: decorations are recomputed only on document changes (not selection
 * moves) via plugin state. The scan is O(doc) per edit — fine for the markdown
 * vaults this targets; if it ever shows on the lag benchmark, bound it to the
 * visible range.
 */

const WIKILINK = /\[\[([^\]\n]+?)\]\]/g;
const wikiLinkPluginKey = new PluginKey<DecorationSet>("wikiLink");

export const WikiLink = Extension.create({
  name: "wikiLink",
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: wikiLinkPluginKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc),
          apply: (tr, value) => (tr.docChanged ? buildDecorations(tr.doc) : value),
        },
        props: {
          decorations(state) {
            return wikiLinkPluginKey.getState(state);
          },
        },
      }),
    ];
  },
});

function buildDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    // Text only, and never inside code (inline `code` mark or a code block) —
    // a `[[…]]` there is literal content, not a link.
    if (!node.isText || !node.text) {
      return;
    }
    if (parent?.type.name === "codeBlock") {
      return;
    }
    if (node.marks.some((mark) => mark.type.name === "code")) {
      return;
    }
    const text = node.text;
    WIKILINK.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKILINK.exec(text)) !== null) {
      const body = match[1] ?? "";
      const { target } = parseWikilinkBody(body);
      if (target === "") {
        continue;
      }
      const from = pos + match.index;
      const to = from + match[0].length;
      const bodyStart = from + 2; // after `[[`
      const bodyEnd = to - 2; // before `]]`

      // Render cleanly: hide the `[[`, the `target|` (when an alias is given),
      // and the `]]`, leaving only the visible title styled as a link. The
      // literal text stays in the document, so markdown round-trips unchanged;
      // raw editing is available in Source mode.
      const pipe = body.indexOf("|");
      let titleStart = bodyStart;
      let titleEnd = bodyEnd;
      if (pipe !== -1) {
        if (body.slice(pipe + 1).trim() !== "") {
          titleStart = bodyStart + pipe + 1; // alias is the visible title
        } else {
          titleEnd = bodyStart + pipe; // empty alias → show the target
        }
      }

      decorations.push(Decoration.inline(from, titleStart, SYNTAX));
      decorations.push(Decoration.inline(titleEnd, to, SYNTAX));
      decorations.push(
        Decoration.inline(titleStart, titleEnd, {
          class: "bob-wikilink",
          "data-wikilink-target": target,
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}

/** Hides the `[[ … ]]` syntax characters (see `.bob-wikilink-syntax`). */
const SYNTAX = { class: "bob-wikilink-syntax" };
