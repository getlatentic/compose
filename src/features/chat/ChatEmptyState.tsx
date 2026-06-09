import { ArrowRight, ChatBot } from "@carbon/react/icons";

/** Starting points offered when a chat has no messages. When a file is in
 * context they speak to "this file"; otherwise they're workspace-level. They
 * prefill the composer (not auto-send) so the user stays in control. */
const FILE_SUGGESTIONS = ["Summarize this file", "Turn this into a table", "What are the key points?"];
const WORKSPACE_SUGGESTIONS = [
  "Help me outline a new note",
  "Find notes related to what I'm writing",
  "What can you help me with?",
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
  /** Drop a suggestion into the composer (the user reviews + sends). */
  onUseSuggestion: (text: string) => void;
}) {
  const suggestions = contextFileLabel ? FILE_SUGGESTIONS : WORKSPACE_SUGGESTIONS;

  return (
    <div className="bob-chat-empty">
      <span className="bob-chat-empty__mark" aria-hidden>
        <ChatBot size={20} />
      </span>
      <h3 className="bob-chat-empty__title">New conversation</h3>
      <p className="bob-chat-empty__hint">
        {contextFileLabel ? (
          <>
            I can already see <strong>{contextFileLabel}</strong> — the file you&rsquo;re viewing.
            Ask anything, or start with one of these.
          </>
        ) : (
          <>Ask anything about your workspace, or start with one of these.</>
        )}
      </p>
      <div className="bob-chat-empty__suggestions">
        {suggestions.map((text) => (
          <button
            type="button"
            key={text}
            className="bob-chat-empty__suggestion"
            onClick={() => onUseSuggestion(text)}
          >
            <ArrowRight size={14} aria-hidden />
            <span>{text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
