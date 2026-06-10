import type { Plugin } from "unified";

import { parseWikilinkBody } from "../links/wikilink";

/** The subset of an mdast node this transform touches. Declared locally so the
 * markdown core needs no `@types/mdast` dependency (matches remarkHardBreaks). */
interface MdastNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdastNode[];
}

const WIKILINK = /\[\[([^\]\n]+?)\]\]/g;

/**
 * Turn `[[target]]` / `[[target|label]]` into link nodes so the chat renderer's
 * link override ({@link MarkdownLink}) can navigate them.
 *
 * The href is `#wikilink:<encoded-target>` — a fragment URL, which survives
 * `rehype-sanitize` (a custom scheme like `wikilink:` would be stripped). The
 * link component recognizes the prefix and resolves the target against the
 * workspace. Scoped to the chat processor via
 * `createMarkdownProcessor({ wikilinks: true })`; the document preview leaves
 * `[[…]]` as plain text.
 *
 * `text` nodes only, and never inside an existing link — so fenced/inline code
 * and real markdown links are left intact.
 */
export const remarkWikilink: Plugin<[]> = () => (tree) => {
  transformChildren(tree as MdastNode);
};

function transformChildren(node: MdastNode): void {
  if (!node.children) {
    return;
  }
  const next: MdastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value && child.value.includes("[[")) {
      next.push(...splitWikilinks(child.value));
    } else {
      if (child.type !== "link" && child.type !== "linkReference") {
        transformChildren(child);
      }
      next.push(child);
    }
  }
  node.children = next;
}

function splitWikilinks(value: string): MdastNode[] {
  const out: MdastNode[] = [];
  let last = 0;
  WIKILINK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK.exec(value)) !== null) {
    if (match.index > last) {
      out.push({ type: "text", value: value.slice(last, match.index) });
    }
    const { target, label } = parseWikilinkBody(match[1] ?? "");
    if (target === "") {
      // Malformed (`[[|x]]` / `[[]]`) — keep the literal text.
      out.push({ type: "text", value: match[0] });
    } else {
      out.push({
        type: "link",
        url: `#wikilink:${encodeURIComponent(target)}`,
        children: [{ type: "text", value: label }],
      });
    }
    last = match.index + match[0].length;
  }
  if (last < value.length) {
    out.push({ type: "text", value: value.slice(last) });
  }
  return out;
}
