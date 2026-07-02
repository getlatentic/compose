import { useCallback, useState } from "react";
import { Document } from "@carbon/react/icons";

import { basename } from "../../lib/workspace/displayPath";
import { MarkdownMessage } from "./MarkdownMessage";
import { parseExcerptPreamble } from "./excerptPreamble";

/** Collapse the excerpt behind "Show more" once it's long enough to crowd the
 * thread. A heuristic on the source text (line and character count) so it's
 * deterministic — no layout measurement, so it renders the same in a test. */
function isLongExcerpt(quote: string): boolean {
  return quote.length > 300 || quote.split("\n").length > 6;
}

/**
 * A commented passage sent to chat, as one card for both new and legacy
 * messages. The file name (full path on hover) sits with the selection's line
 * — shown only when we have it (persisted excerpt); legacy messages omit it —
 * above the quoted excerpt (markdown, straight from the message content) and
 * then the note. Because the content is always persisted, the card looks
 * identical before and after a reload. Only the EXCERPT collapses behind "Show
 * more": the note (the user's comment) always stays visible below it.
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

  const { path, quote, note } = parsed;
  const long = isLongExcerpt(quote);
  return (
    <div className="excerpt-card">
      <div className="excerpt-card__head">
        <Document size={14} aria-hidden />
        <span className="excerpt-card__file" title={path}>
          {basename(path)}
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
          long && !expanded
            ? "excerpt-card__excerpt excerpt-card__excerpt--clamped"
            : "excerpt-card__excerpt"
        }
      >
        <MarkdownMessage content={quote} />
      </div>
      {long ? (
        <button type="button" className="excerpt-card__more" onClick={toggle}>
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
      {note ? <p className="excerpt-card__note">{note}</p> : null}
    </div>
  );
}
