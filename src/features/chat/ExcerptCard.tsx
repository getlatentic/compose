import { useCallback, useState } from "react";
import { Document } from "@carbon/react/icons";

import { basename } from "../../lib/workspace/displayPath";
import { MarkdownMessage } from "./MarkdownMessage";
import { parseExcerptPreamble } from "./excerptPreamble";

/** Collapse the body behind "Show more" once it's long enough to crowd the
 * thread. A heuristic on the source text (line and character count) so it's
 * deterministic — no layout measurement, so it renders the same in a test. */
function isLongBody(body: string): boolean {
  return body.length > 300 || body.split("\n").length > 6;
}

/**
 * A commented passage sent to chat, as one card for both new and legacy
 * messages. The file name (full path on hover) sits with the selection's line
 * — shown only when we have it (persisted excerpt); legacy messages omit it —
 * above the excerpt + note rendered as markdown straight from the message
 * content. Because the body comes from `content` (always persisted) it looks
 * identical before and after a reload. A long body collapses behind "Show more".
 */
export function ExcerptCard({
  content,
  line,
  column,
}: {
  content: string;
  line?: number;
  column?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((value) => !value), []);

  const parsed = parseExcerptPreamble(content);
  if (!parsed) {
    // Not a recognizable excerpt — fall back to the raw text rather than an
    // empty card. (MessageRow only routes excerpt messages here, so this is a
    // guard, not the normal path.)
    return <>{content}</>;
  }

  const long = isLongBody(parsed.body);
  return (
    <div className="excerpt-card">
      <div className="excerpt-card__head">
        <Document size={14} aria-hidden />
        <span className="excerpt-card__file" title={parsed.path}>
          {basename(parsed.path)}
        </span>
        {line != null ? (
          <span className="excerpt-card__loc">
            L{line}
            {column != null ? `:C${column}` : ""}
          </span>
        ) : null}
      </div>
      <div
        className={
          long && !expanded ? "excerpt-card__body excerpt-card__body--clamped" : "excerpt-card__body"
        }
      >
        <MarkdownMessage content={parsed.body} />
      </div>
      {long ? (
        <button type="button" className="excerpt-card__more" onClick={toggle}>
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
