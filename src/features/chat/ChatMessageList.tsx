import { useEffect, useRef } from "react";

import type { ChatRunState, WorkspaceChatMessage } from "../../app/workspaceModel";
import { MessageRow, type MessageRowCallbacks } from "./MessageRow";

/**
 * The scrollable transcript: empty-state prompt when there are no
 * messages, otherwise the message stack. Owns the pin-to-bottom behavior
 * — it re-pins when the message set or run state changes (a streaming
 * turn appends content under the current run, which `runState` tracks).
 */
export function ChatMessageList({
  callbacks,
  messages,
  runState,
}: {
  callbacks: MessageRowCallbacks;
  messages: WorkspaceChatMessage[];
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
        <div className="bob-chat-empty">
          <p className="bob-chat-empty__title">Ask your assistant</p>
          <p>Use the open note or a comment selection as context.</p>
        </div>
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
