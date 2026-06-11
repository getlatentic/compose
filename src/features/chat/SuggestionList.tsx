import { Checkmark, Close } from "@carbon/react/icons";

import type { WorkspaceDocumentSuggestion } from "../../app/workspaceModel";
import { ChangePreview } from "../diff/ChangePreview";

/**
 * The previewable changes attached to an assistant message, awaiting the
 * user's approval. Two sources feed one list: bob's byte-range `replace`
 * edits, and the whole-file `create` / `rewrite` / `delete` changes a
 * write-capable harness (Claude / Codex) made in its review sandbox. Accept /
 * reject route back through the workspace store.
 */
export function SuggestionList({
  onAccept,
  onOpenDocument,
  onReject,
  suggestions,
}: {
  onAccept: (suggestionId: string) => void;
  onOpenDocument: (path: string) => void;
  onReject: (suggestionId: string) => void;
  suggestions: WorkspaceDocumentSuggestion[];
}) {
  return (
    <div className="bob-suggestion-list" aria-label="Suggested changes">
      {suggestions.map((suggestion) => (
        <article className="bob-suggestion" key={suggestion.id}>
          <header className="bob-suggestion__header">
            <div>
              <div className="bob-suggestion__title">{suggestion.title}</div>
              <button
                type="button"
                className="bob-suggestion__path"
                onClick={() => onOpenDocument(suggestion.filePath)}
              >
                {suggestion.filePath}
              </button>
            </div>
            <span
              className={`bob-suggestion__status bob-suggestion__status--${suggestion.status}`}
            >
              {suggestion.status}
            </span>
          </header>

          <SuggestionPreview suggestion={suggestion} />

          {isStale(suggestion) ? (
            <div className="bob-suggestion__stale" role="alert">
              This file changed on your computer since the assistant started. Accepting
              will replace your version.
            </div>
          ) : null}

          {suggestion.statusMessage ? (
            <div className="bob-suggestion__message">{suggestion.statusMessage}</div>
          ) : null}

          <div className="bob-suggestion__actions">
            <button
              type="button"
              className="bob-suggestion__action bob-suggestion__action--accept"
              disabled={suggestion.status !== "pending"}
              onClick={() => onAccept(suggestion.id)}
            >
              <Checkmark size={16} />
              <span>Accept</span>
            </button>
            <button
              type="button"
              className="bob-suggestion__action"
              disabled={suggestion.status !== "pending"}
              onClick={() => onReject(suggestion.id)}
            >
              <Close size={16} />
              <span>Reject</span>
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

/** Only whole-file changes can go stale against a concurrent user edit. */
function isStale(suggestion: WorkspaceDocumentSuggestion): boolean {
  return (suggestion.kind === "rewrite" || suggestion.kind === "delete") && suggestion.stale;
}

/** The change preview as a collapsible unified diff, shaped to the kind. */
function SuggestionPreview({ suggestion }: { suggestion: WorkspaceDocumentSuggestion }) {
  switch (suggestion.kind) {
    case "replace":
      return (
        <ChangePreview
          before={suggestion.originalText}
          after={suggestion.replacement}
          previewOmitted={false}
          omittedLabel=""
          omittedSize={0}
        />
      );
    case "rewrite":
      return (
        <ChangePreview
          before={suggestion.originalText ?? ""}
          after={suggestion.newText ?? ""}
          previewOmitted={suggestion.previewOmitted}
          omittedLabel="Updated file"
          omittedSize={suggestion.newSize}
        />
      );
    case "create":
      return (
        <ChangePreview
          before=""
          after={suggestion.newText ?? ""}
          previewOmitted={suggestion.previewOmitted}
          omittedLabel="New file"
          omittedSize={suggestion.newSize}
        />
      );
    case "delete":
      return (
        <ChangePreview
          before={suggestion.originalText ?? ""}
          after=""
          previewOmitted={suggestion.previewOmitted}
          omittedLabel="File to delete"
          omittedSize={suggestion.originalSize}
        />
      );
  }
}
