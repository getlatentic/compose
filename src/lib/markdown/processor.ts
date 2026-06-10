import rehypeSanitize from "rehype-sanitize";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

import { remarkHardBreaks } from "./remarkHardBreaks";
import { remarkWikilink } from "./remarkWikilink";

export interface MarkdownProcessorOptions {
  /**
   * Treat single newlines as hard line breaks (`<br>`). The chat
   * renderer enables this so the assistant's intended line breaks are
   * honored; the document preview leaves it off to keep standard
   * markdown semantics. See [remarkHardBreaks](remarkHardBreaks.ts).
   */
  hardBreaks?: boolean;
  /**
   * Turn `[[Note]]` into navigable links. The chat renderer enables this so an
   * agent's wikilinks open the target file; the document preview leaves them as
   * plain text (the editor decorates them itself). See
   * [remarkWikilink](remarkWikilink.ts).
   */
  wikilinks?: boolean;
}

/**
 * The single markdown → sanitized-hast pipeline config used app-wide.
 *
 * Two consumers build from this factory so there is exactly one parsing
 * + sanitization contract (one owner, per the editor guide):
 *
 * - the worker preview ([markdownPipeline.ts](../../workers/markdownPipeline.ts)) —
 *   `processor.run` (async), document-scale, for word-count / heading
 *   metadata; and
 * - the synchronous chat renderer
 *   ([markdownToReact.tsx](markdownToReact.tsx)) — `processor.runSync`,
 *   per-message, small content, for React output (with `hardBreaks`).
 *
 * Every consumer therefore inherits the same `rehype-sanitize` boundary
 * — there is no path that renders unsanitized model/user markdown.
 */
export function createMarkdownProcessor(options: MarkdownProcessorOptions = {}) {
  const processor = unified().use(remarkParse);
  if (options.hardBreaks) {
    processor.use(remarkHardBreaks);
  }
  if (options.wikilinks) {
    processor.use(remarkWikilink);
  }
  return processor.use(remarkRehype).use(rehypeSanitize);
}
