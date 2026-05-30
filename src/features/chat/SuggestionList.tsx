import { Checkmark, Close } from "@carbon/react/icons";

import type { WorkspaceDocumentSuggestion } from "../../app/workspaceModel";

/**
 * The previewable suggested-edits attached to an assistant message
 * (today only the bob harness proposes these; CLI harnesses write to
 * disk). Accept/reject route back through the workspace store.
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
    <div className="bob-suggestion-list" aria-label="Bob suggested edits">
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

          <div className="bob-suggestion__diff" aria-label="Suggested edit preview">
            <pre className="bob-suggestion__before">{suggestion.originalText || "(empty)"}</pre>
            <pre className="bob-suggestion__after">{suggestion.replacement || "(delete)"}</pre>
          </div>

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
