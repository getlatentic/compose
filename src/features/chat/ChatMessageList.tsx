import { useCallback, useLayoutEffect, useRef } from "react";

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
/** How far from the bottom still counts as "following" — a hair of slack so a
 *  sub-pixel layout rounding does not read as a deliberate scroll-up. */
const PINNED_SLACK = 24;

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

  // Whether the reader is following the conversation, as of their last
  // scroll. Content growing underneath fires no scroll event, so a reply that
  // lands in one lump cannot read as the reader having scrolled away.
  const following = useRef(true);
  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (element) {
      following.current = element.scrollHeight - element.scrollTop - element.clientHeight <= PINNED_SLACK;
    }
  }, []);

  const lastSeenId = useRef(messages[messages.length - 1]?.id);

  // Follow the conversation only while the reader is following it, so
  // scrolling up to re-read something is not undone by the next delta. Before
  // paint, so the new content never shows a frame out of place. Re-pins on
  // `composerHeight` too: the spacer below grows in the same commit.
  useLayoutEffect(() => {
    // The writer just sent a message: show it, wherever they had scrolled.
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.id !== lastSeenId.current) {
      lastSeenId.current = lastMessage?.id;
      if (lastMessage?.role === "user") following.current = true;
    }
    const element = scrollRef.current;
    if (element && following.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, runState, composerHeight]);

  return (
    <div ref={scrollRef} className="chat-messages" onScroll={onScroll}>
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
