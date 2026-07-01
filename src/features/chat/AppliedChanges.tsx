import type { WorkspaceAppliedChange } from "../../app/workspaceModel";
import { basename } from "../../lib/workspace/displayPath";
import { ChangePreview } from "../diff/ChangePreview";
import { computeUnifiedDiff } from "../diff/lineDiff";

/**
 * The file changes a `snapshot`-mode run already made on disk, shown under its
 * assistant message as informational diffs — not the accept/reject cards of
 * the clone-gate (`SuggestionList`). Already applied; the undo path is the
 * file's version history. The path opens the file.
 */
export function AppliedChanges({
  changes,
  onOpenDocument,
}: {
  changes: WorkspaceAppliedChange[];
  onOpenDocument: (path: string) => void;
}) {
  // A "rewrite" whose before/after produce no line diff is a no-op write (a
  // model re-saving identical content) — an "Edited · No textual changes" card
  // for it is noise, so drop it. Creates and deletes always show.
  const visible = changes.filter((change) => !isNoOpRewrite(change));
  if (visible.length === 0) {
    return null;
  }
  return (
    <div className="applied-list" aria-label="Changes the assistant made">
      {visible.map((change, index) => (
        <article className="applied" key={`${change.filePath}-${index}`}>
          <header className="applied__header">
            <span className={`applied__badge applied__badge--${change.kind}`}>
              {appliedLabel(change.kind)}
            </span>
            <button
              type="button"
              className="applied__path"
              title={change.filePath}
              onClick={() => onOpenDocument(change.filePath)}
            >
              {basename(change.filePath)}
            </button>
          </header>
          <ChangePreview {...changeSides(change)} />
        </article>
      ))}
    </div>
  );
}

function appliedLabel(kind: WorkspaceAppliedChange["kind"]): string {
  switch (kind) {
    case "create":
      return "Created";
    case "delete":
      return "Deleted";
    case "rewrite":
      return "Edited";
  }
}

/** A rewrite that produced no textual change (identical before/after at the line
 * level) — mirrors UnifiedDiff's empty-diff condition. A previewless change
 * (large/binary, no text to diff) is never treated as a no-op. */
function isNoOpRewrite(change: WorkspaceAppliedChange): boolean {
  if (change.kind !== "rewrite" || change.previewOmitted) {
    return false;
  }
  return computeUnifiedDiff(change.originalText ?? "", change.newText ?? "").hunks.length === 0;
}

/** Map a change to the before/after sides + omitted-card info `ChangePreview` wants. */
function changeSides(change: WorkspaceAppliedChange): {
  before: string;
  after: string;
  previewOmitted: boolean;
  omittedLabel: string;
  omittedSize: number;
} {
  switch (change.kind) {
    case "create":
      return {
        before: "",
        after: change.newText ?? "",
        previewOmitted: change.previewOmitted,
        omittedLabel: "New file",
        omittedSize: change.newSize,
      };
    case "delete":
      return {
        before: change.originalText ?? "",
        after: "",
        previewOmitted: change.previewOmitted,
        omittedLabel: "Deleted file",
        omittedSize: change.originalSize,
      };
    case "rewrite":
      return {
        before: change.originalText ?? "",
        after: change.newText ?? "",
        previewOmitted: change.previewOmitted,
        omittedLabel: "Updated file",
        omittedSize: change.newSize,
      };
  }
}
