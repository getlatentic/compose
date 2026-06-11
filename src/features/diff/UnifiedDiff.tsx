import { useMemo, useState } from "react";
import { ChevronRight } from "@carbon/react/icons";

import { computeUnifiedDiff } from "./lineDiff";

/** Diffs at or below this many changed lines open expanded by default. */
const AUTO_OPEN_CHANGES = 24;

/**
 * A collapsible unified diff: a "+N −M" summary that expands to show the
 * changed lines (red removals, green additions) in document order, with
 * long unchanged stretches folded to a "⋯ N unchanged lines" marker.
 * Replaces the side-by-side before/after panes, which forced the reader
 * to eyeball two full copies to find the change.
 */
export function UnifiedDiff({
  after,
  before,
  defaultOpen,
}: {
  after: string;
  before: string;
  /** Force the initial open state; otherwise small diffs auto-open. */
  defaultOpen?: boolean;
}) {
  const diff = useMemo(() => computeUnifiedDiff(before, after), [before, after]);
  const autoOpen = diff.added + diff.removed <= AUTO_OPEN_CHANGES;
  const [open, setOpen] = useState(defaultOpen ?? autoOpen);

  if (diff.hunks.length === 0) {
    return <div className="bob-diff bob-diff--empty">No textual changes.</div>;
  }

  return (
    <div className="bob-diff">
      <button
        type="button"
        className="bob-diff__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight
          size={14}
          className={`bob-diff__chevron${open ? " bob-diff__chevron--open" : ""}`}
          aria-hidden
        />
        <span className="bob-diff__summary">
          {diff.added > 0 ? <span className="bob-diff__added">+{diff.added}</span> : null}
          {diff.removed > 0 ? <span className="bob-diff__removed">−{diff.removed}</span> : null}
          <span className="bob-diff__summary-label">{open ? "Hide changes" : "Show changes"}</span>
        </span>
      </button>

      {open ? (
        <div className="bob-diff__body" role="table" aria-label="Unified diff">
          {diff.truncated ? (
            <div className="bob-diff__notice">
              File too large to diff line-by-line — showing the full replacement.
            </div>
          ) : null}
          {/* Hunks and their lines are positional and recomputed wholesale
              for a given before/after pair — never reordered — so the index
              is a stable key. */}
          {diff.hunks.map((hunk, hunkIndex) => (
            <div className="bob-diff__hunk" key={hunkIndex}>
              {hunk.skippedBefore > 0 ? (
                <div className="bob-diff__fold" role="separator">
                  ⋯ {hunk.skippedBefore} unchanged{" "}
                  {hunk.skippedBefore === 1 ? "line" : "lines"}
                </div>
              ) : null}
              {hunk.lines.map((line, lineIndex) => (
                <div
                  key={lineIndex}
                  className={`bob-diff__line bob-diff__line--${line.kind}`}
                  role="row"
                >
                  <span className="bob-diff__gutter" aria-hidden>
                    {line.beforeLine ?? ""}
                  </span>
                  <span className="bob-diff__gutter" aria-hidden>
                    {line.afterLine ?? ""}
                  </span>
                  <span className="bob-diff__sign" aria-hidden>
                    {line.kind === "add" ? "+" : line.kind === "remove" ? "−" : " "}
                  </span>
                  <span className="bob-diff__text">{line.text || " "}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
