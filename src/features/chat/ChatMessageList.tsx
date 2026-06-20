import { useEffect, useRef } from "react";

import type { ChatRunState, WorkspaceChatMessage } from "../../app/workspaceModel";
import { ChatEmptyState } from "./ChatEmptyState";
import { MessageRow, type MessageRowCallbacks } from "./MessageRow";
import { WorkingIndicator } from "./WorkingIndicator";

/**
 * The scrollable transcript: the new-conversation empty state when there are
 * no messages, otherwise the message stack. Owns the pin-to-bottom behavior
 * — it re-pins when the message set or run state changes (a streaming
 * turn appends content under the current run, which `runState` tracks).
 */
export function ChatMessageList({
  callbacks,
  composerHeight,
  contextFileLabel,
  messages,
  onUseSuggestion,
  runState,
}: {
  callbacks: MessageRowCallbacks;
  /** Live height (px) of the floating composer. An end spacer of this height
   * reserves room so the last turn scrolls clear of it; re-pinning to bottom
   * also keys off it so a composer resize keeps the latest message in view. */
  composerHeight: number;
  /** The file currently in context, named in the empty state. */
  contextFileLabel: string | null;
  messages: WorkspaceChatMessage[];
  /** Use an empty-state suggestion. `readOnly` runs it in read-only mode (the
   * harness refuses writes) for read-only-intent prompts; others just prefill. */
  onUseSuggestion: (text: string, opts?: { readOnly?: boolean }) => void;
  runState: ChatRunState;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // The brief gap right after send, before the assistant message (which carries
  // its own status line) exists: show the working loader so the turn feels
  // responsive from the first moment.
  const running = runState === "starting" || runState === "streaming";
  const showStartingLoader = running && messages[messages.length - 1]?.role !== "assistant";

  // Re-pin on `composerHeight` too: the spacer below grows in the same commit,
  // so reading `scrollHeight` here already includes the reserved space — no
  // race with the composer's resize observer.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    element.scrollTop = element.scrollHeight;
  }, [messages, runState, composerHeight]);

  return (
    <div ref={scrollRef} className="chat-messages">
      {messages.length === 0 ? (
        <ChatEmptyState contextFileLabel={contextFileLabel} onUseSuggestion={onUseSuggestion} />
      ) : (
        <div className="message-stack">
          {messages.map((message) => (
            <MessageRow callbacks={callbacks} key={message.id} message={message} />
          ))}
          {showStartingLoader ? <WorkingIndicator /> : null}
          {/* Reserves room for the floating composer so the last turn scrolls
              fully clear of it. A real layout element (not CSS-var padding) so
              `scrollHeight` reflects it deterministically when re-pinning. */}
          <div className="chat-messages__composer-spacer" style={{ blockSize: composerHeight }} />
        </div>
      )}
    </div>
  );
}
