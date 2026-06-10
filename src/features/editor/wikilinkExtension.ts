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
      const { target } = parseWikilinkBody(match[1] ?? "");
      if (target === "") {
        continue;
      }
      const from = pos + match.index;
      const to = from + match[0].length;
      decorations.push(
        Decoration.inline(from, to, {
          class: "bob-wikilink",
          "data-wikilink-target": target,
        }),
      );
    }
  });
  return DecorationSet.create(doc, decorations);
}
