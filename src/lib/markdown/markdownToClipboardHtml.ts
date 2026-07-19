import { toHtml } from "hast-util-to-html";

import { enrichClipboardTree } from "./clipboardRich";
import { createMarkdownProcessor } from "./processor";

/**
 * Markdown → HTML string for the clipboard's `text/html` flavor (#135), so a
 * copy pastes formatted into Google Docs / Slack / Word. Built on the app's
 * single markdown pipeline, so clipboard HTML inherits the same GFM grammar
 * and `rehype-sanitize` boundary as every other rendering; code fences and
 * mermaid diagrams are then enriched post-sanitize (see
 * [clipboardRich](./clipboardRich.ts)). Selections are small, so the
 * synchronous run stays off any hot path.
 */
const processor = createMarkdownProcessor();

export function markdownToClipboardHtml(markdown: string): string | null {
  try {
    const mdast = processor.parse(markdown);
    demoteMetaMermaidFences(mdast as MdastParent);
    const tree = processor.runSync(mdast);
    enrichClipboardTree(tree);
    return toHtml(tree);
  } catch {
    // A parse hiccup must never break copy — the plain flavor still ships.
    return null;
  }
}

interface MdastParent {
  type?: string;
  lang?: string | null;
  meta?: string | null;
  children?: MdastParent[];
}

/** The editor renders a diagram only for a bare `mermaid` info string; a fence
 *  like ```mermaid title=x shows as source there. Dropping its `lang` before
 *  the hast conversion keeps the clipboard's classification identical — the
 *  enrichment never sees a `language-mermaid` class the editor wouldn't
 *  render (hast carries no `meta`, so this is the last place to tell). */
function demoteMetaMermaidFences(node: MdastParent): void {
  if (node.type === "code" && node.meta && /^mermaid$/i.test(node.lang ?? "")) {
    node.lang = null;
  }
  for (const child of node.children ?? []) demoteMetaMermaidFences(child);
}
