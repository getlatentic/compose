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
    const tree = processor.runSync(processor.parse(markdown));
    enrichClipboardTree(tree);
    return toHtml(tree);
  } catch {
    // A parse hiccup must never break copy — the plain flavor still ships.
    return null;
  }
}
