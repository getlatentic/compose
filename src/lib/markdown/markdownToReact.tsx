import type { Root } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

import { createMarkdownProcessor } from "./processor";

/**
 * Synchronous markdown → React, reusing the shared sanitized processor
 * ([processor.ts](processor.ts)). `runSync` is safe here because every
 * plugin in the pipeline (remark-parse / remark-rehype / rehype-sanitize)
 * is synchronous; we never need the worker's async `run`.
 *
 * This is the *render primitive* — pure, no React state, no wrapper
 * element. Callers that want memoization across re-renders (e.g. a
 * streaming chat bubble) wrap it in a `memo`'d component keyed by the
 * source string; see `MarkdownMessage`.
 */
// Chat renders the assistant's reply: single newlines are intentional
// line breaks, so `hardBreaks` is on (unlike the document preview).
const processor = createMarkdownProcessor({ hardBreaks: true });

export function renderMarkdownToReact(markdown: string): ReactNode {
  const tree = processor.runSync(processor.parse(markdown)) as Root;
  return toJsxRuntime(tree, { Fragment, jsx, jsxs });
}
