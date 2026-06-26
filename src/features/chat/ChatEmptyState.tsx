import { ArrowRight, ChatBot } from "@carbon/react/icons";

/** A starting-point prompt. `readOnly` marks read-only-intent asks (summarize,
 * key points) that run in read-only mode — the harness refuses any write, so a
 * read-only ask can't change files. The user types a request manually for an
 * editable run. */
interface Suggestion {
  label: string;
  readOnly?: boolean;
}

/** Starting points offered when a chat has no messages. When a file is in
 * context they speak to "this file"; otherwise they're workspace-level. */
const FILE_SUGGESTIONS: Suggestion[] = [
  { label: "Summarize this file", readOnly: true },
  { label: "Turn this into a table" },
  { label: "What are the key points?", readOnly: true },
];
const WORKSPACE_SUGGESTIONS: Suggestion[] = [
  { label: "Help me start a new document" },
  { label: "Brainstorm ideas for something I'm writing", readOnly: true },
  { label: "What can you help me do?", readOnly: true },
];

/**
 * The new-conversation empty state: the assistant mark, a heading, a line
 * naming the file currently in context, and a few suggested prompts. Pure
 * and props-driven — the parent supplies the context file label and the
 * suggestion handler.
 */
export function ChatEmptyState({
  contextFileLabel,
  onUseSuggestion,
}: {
  /** The file currently attached as context (the open note), or null. */
  contextFileLabel: string | null;
  /** Use a suggestion. `readOnly` runs read-only-intent prompts in read-only
   * mode; others prefill the composer for the user to send. */
  onUseSuggestion: (text: string, opts?: { readOnly?: boolean }) => void;
}) {
  const suggestions = contextFileLabel ? FILE_SUGGESTIONS : WORKSPACE_SUGGESTIONS;
  // Name just the file, not its full workspace-relative path — a deep path
  // overflows the narrow panel (break-word CSS handles a long name on top).
  const contextFileName = contextFileLabel?.split("/").pop() || contextFileLabel;

  return (
    <div className="chat-empty">
      <span className="chat-empty__mark" aria-hidden>
        <ChatBot size={20} />
      </span>
      <h3 className="chat-empty__title">Ask the assistant</h3>
      <p className="chat-empty__hint">
        {contextFileLabel ? (
          <>
            I can already see <strong>{contextFileName}</strong> — the file you&rsquo;re viewing.
            Ask anything, or start with one of these.
          </>
        ) : (
          <>I can read, edit, and organize the notes in this workspace. Start a draft, or try one of these.</>
        )}
      </p>
      <div className="chat-empty__suggestions">
        {suggestions.map((suggestion) => (
          <button
            type="button"
            key={suggestion.label}
            className="chat-empty__suggestion"
            onClick={() => onUseSuggestion(suggestion.label, { readOnly: suggestion.readOnly })}
          >
            <ArrowRight size={14} aria-hidden />
            <span>{suggestion.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
