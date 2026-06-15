import type { WorkspaceAppliedChange } from "../../app/workspaceModel";
import { ChangePreview } from "../diff/ChangePreview";

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
  return (
    <div className="applied-list" aria-label="Changes the assistant made">
      {changes.map((change, index) => (
        <article className="applied" key={`${change.filePath}-${index}`}>
          <header className="applied__header">
            <span className={`applied__badge applied__badge--${change.kind}`}>
              {appliedLabel(change.kind)}
            </span>
            <button
              type="button"
              className="applied__path"
              onClick={() => onOpenDocument(change.filePath)}
            >
              {change.filePath}
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
