import { memo } from "react";

import { renderMarkdownToReact } from "../../lib/markdown/markdownToReact";

/**
 * An assistant message body rendered as sanitized markdown.
 *
 * Memoized on `content`: a settled message never reparses when a sibling
 * streams, while the active (streaming) message reparses each rAF batch
 * as `content` grows — the "live, memoized" behavior. The list keys each
 * row by message id, so this component instance is stable across a run
 * and its `content` prop is the only thing that changes.
 */
export const MarkdownMessage = memo(function MarkdownMessage({ content }: { content: string }) {
  return <div className="bob-markdown">{renderMarkdownToReact(content)}</div>;
});
