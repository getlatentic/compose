import { ArrowRight, ChatBot } from "@carbon/react/icons";

/** A starting-point prompt. `review` marks read-only-intent asks (summarize,
 * key points) that should default to Review mode — any edit the model makes is
 * shown for approval rather than auto-applied — so a read-only ask never writes
 * silently. The user can still flip the footer pill to Auto-apply. */
interface Suggestion {
  label: string;
  review?: boolean;
}

/** Starting points offered when a chat has no messages. When a file is in
 * context they speak to "this file"; otherwise they're workspace-level. They
 * prefill the composer (not auto-send) so the user stays in control. */
const FILE_SUGGESTIONS: Suggestion[] = [
  { label: "Summarize this file", review: true },
  { label: "Turn this into a table" },
  { label: "What are the key points?", review: true },
];
const WORKSPACE_SUGGESTIONS: Suggestion[] = [
  { label: "Help me outline a new note" },
  { label: "Find notes related to what I'm writing", review: true },
  { label: "What can you help me with?", review: true },
];

/**
 * The new-conversation empty state: the assistant mark, a heading, a line
 * naming the file currently in context, and a few suggested prompts. Pure
 * and props-driven — the parent supplies the context file label and a
 * prefill callback.
 */
export function ChatEmptyState({
  contextFileLabel,
  onUseSuggestion,
}: {
  /** The file currently attached as context (the open note), or null. */
  contextFileLabel: string | null;
  /** Drop a suggestion into the composer (the user reviews + sends). `review`
   * defaults the run to Review mode for read-only-intent prompts. */
  onUseSuggestion: (text: string, opts?: { review?: boolean }) => void;
}) {
  const suggestions = contextFileLabel ? FILE_SUGGESTIONS : WORKSPACE_SUGGESTIONS;

  return (
    <div className="chat-empty">
      <span className="chat-empty__mark" aria-hidden>
        <ChatBot size={20} />
      </span>
      <h3 className="chat-empty__title">New conversation</h3>
      <p className="chat-empty__hint">
        {contextFileLabel ? (
          <>
            I can already see <strong>{contextFileLabel}</strong> — the file you&rsquo;re viewing.
            Ask anything, or start with one of these.
          </>
        ) : (
          <>Ask anything about your workspace, or start with one of these.</>
        )}
      </p>
      <div className="chat-empty__suggestions">
        {suggestions.map((suggestion) => (
          <button
            type="button"
            key={suggestion.label}
            className="chat-empty__suggestion"
            onClick={() => onUseSuggestion(suggestion.label, { review: suggestion.review })}
          >
            <ArrowRight size={14} aria-hidden />
            <span>{suggestion.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
