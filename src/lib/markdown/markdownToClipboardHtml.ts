import { toHtml } from "hast-util-to-html";

import { createMarkdownProcessor } from "./processor";

/**
 * Markdown → HTML string for the clipboard's `text/html` flavor (#135), so a
 * copy pastes formatted into Google Docs / Slack / Word. Built on the app's
 * single markdown pipeline, so clipboard HTML inherits the same GFM grammar
 * and `rehype-sanitize` boundary as every other rendering. Selections are
 * small, so the synchronous run stays off any hot path.
 */
const processor = createMarkdownProcessor();

export function markdownToClipboardHtml(markdown: string): string | null {
  try {
    const tree = processor.runSync(processor.parse(markdown));
    return toHtml(tree);
  } catch {
    // A parse hiccup must never break copy — the plain flavor still ships.
    return null;
  }
}
