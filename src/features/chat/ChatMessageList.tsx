import { useEffect, useRef } from "react";

import type { ChatRunState, WorkspaceChatMessage } from "../../app/workspaceModel";
import { ChatEmptyState } from "./ChatEmptyState";
import { MessageRow, type MessageRowCallbacks } from "./MessageRow";

/**
 * The scrollable transcript: the new-conversation empty state when there are
 * no messages, otherwise the message stack. Owns the pin-to-bottom behavior
 * — it re-pins when the message set or run state changes (a streaming
 * turn appends content under the current run, which `runState` tracks).
 */
export function ChatMessageList({
  callbacks,
  contextFileLabel,
  messages,
  onUseSuggestion,
  runState,
}: {
  callbacks: MessageRowCallbacks;
  /** The file currently in context, named in the empty state. */
  contextFileLabel: string | null;
  messages: WorkspaceChatMessage[];
  /** Prefill the composer from an empty-state suggestion. */
  onUseSuggestion: (text: string) => void;
  runState: ChatRunState;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [messages, runState]);

  return (
    <div ref={scrollRef} className="bob-chat-messages">
      {messages.length === 0 ? (
        <ChatEmptyState contextFileLabel={contextFileLabel} onUseSuggestion={onUseSuggestion} />
      ) : (
        <div className="bob-message-stack">
          {messages.map((message) => (
            <MessageRow callbacks={callbacks} key={message.id} message={message} />
          ))}
        </div>
      )}
    </div>
  );
}
