import { Checkmark, Close } from "@carbon/react/icons";

import type { WorkspaceDocumentSuggestion } from "../../app/workspaceModel";

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

/** The before/after preview, shaped to the change kind. */
function SuggestionPreview({ suggestion }: { suggestion: WorkspaceDocumentSuggestion }) {
  switch (suggestion.kind) {
    case "replace":
      return (
        <div className="bob-suggestion__diff" aria-label="Suggested edit preview">
          <pre className="bob-suggestion__before">{suggestion.originalText || "(empty)"}</pre>
          <pre className="bob-suggestion__after">{suggestion.replacement || "(delete)"}</pre>
        </div>
      );
    case "rewrite":
      if (suggestion.previewOmitted) {
        return <OmittedPreview label="Updated file" size={suggestion.newSize} />;
      }
      return (
        <div className="bob-suggestion__diff" aria-label="Suggested edit preview">
          <pre className="bob-suggestion__before">{suggestion.originalText ?? ""}</pre>
          <pre className="bob-suggestion__after">{suggestion.newText ?? ""}</pre>
        </div>
      );
    case "create":
      if (suggestion.previewOmitted) {
        return <OmittedPreview label="New file" size={suggestion.newSize} />;
      }
      return (
        <div className="bob-suggestion__diff" aria-label="New file preview">
          <pre className="bob-suggestion__after">{suggestion.newText ?? "(empty file)"}</pre>
        </div>
      );
    case "delete":
      if (suggestion.previewOmitted) {
        return <OmittedPreview label="File to delete" size={suggestion.originalSize} />;
      }
      return (
        <div className="bob-suggestion__diff" aria-label="File to delete">
          <pre className="bob-suggestion__before">{suggestion.originalText ?? ""}</pre>
        </div>
      );
  }
}

/** Shown when content is binary or too large to inline. */
function OmittedPreview({ label, size }: { label: string; size: number }) {
  return (
    <div className="bob-suggestion__omitted">
      {label} · {formatBytes(size)} · preview not shown
    </div>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} bytes`;
  }
  return `${Math.round(size / 1024)} KB`;
}
