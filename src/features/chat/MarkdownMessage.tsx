import { memo } from "react";

import { renderMarkdownToReact } from "../../lib/markdown/markdownToReact";
import { workspaceMarkdownComponents } from "../../lib/markdown/workspaceLinks";

/**
 * An assistant message body rendered as sanitized markdown.
 *
 * Memoized on `content`: a settled message never reparses when a sibling
 * streams, while the active (streaming) message reparses each rAF batch
 * as `content` grows — the "live, memoized" behavior. The list keys each
 * row by message id, so this component instance is stable across a run
 * and its `content` prop is the only thing that changes.
 *
 * `workspaceMarkdownComponents` (a stable module constant, so it doesn't break
 * the memo) makes links navigate: a link to a workspace file opens it in a tab,
 * an external link opens in the browser. The navigation target comes from
 * `MarkdownLinkContext`, provided by the shell.
 */
export const MarkdownMessage = memo(function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown">
      {renderMarkdownToReact(content, workspaceMarkdownComponents)}
    </div>
  );
});
