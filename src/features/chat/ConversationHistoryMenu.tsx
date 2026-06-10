import { useRef, useState } from "react";
import { ChevronDown, Add, ListBoxes } from "@carbon/react/icons";

import type { ConversationSummary } from "../../lib/ipc/conversationsClient";
import { recentConversations, relativeTime } from "./conversationView";
import { useDismissableLayer } from "./useDismissableLayer";

const RECENT_LIMIT = 8;

/**
 * The chat header's conversation switcher: a trigger showing the open
 * conversation's title + a chevron, opening a dropdown of recent (active)
 * conversations — each with its title, a preview snippet, and a relative
 * time — plus a footer with "New chat" and "All conversations". A lightweight
 * popover (no Carbon menu chrome) opening downward from the header.
 */
export function ConversationHistoryMenu({
  title,
  conversations,
  activeId,
  now,
  onOpen,
  onNewChat,
  onShowAll,
}: {
  title: string;
  conversations: ConversationSummary[];
  activeId: string | null;
  now: number;
  onOpen: (conversationId: string) => void;
  onNewChat: () => void;
  onShowAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useDismissableLayer(open, () => setOpen(false), rootRef);

  const recent = recentConversations(conversations, RECENT_LIMIT);

  return (
    <div className="bob-conv-history" ref={rootRef}>
      <button
        type="button"
        className="bob-conv-history__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Conversation history"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="bob-conv-history__title">{title}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open ? (
        <div className="bob-conv-history__panel" role="menu" aria-label="Recent conversations">
          {recent.length === 0 ? (
            <p className="bob-conv-history__empty">No conversations yet</p>
          ) : (
            <ul className="bob-conv-history__list">
              {recent.map((conversation) => (
                <li key={conversation.conversationId} role="none">
                  <button
                    type="button"
                    role="menuitem"
                    className={[
                      "bob-conv-history__item",
                      conversation.conversationId === activeId ? "is-active" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => {
                      setOpen(false);
                      onOpen(conversation.conversationId);
                    }}
                  >
                    <span className="bob-conv-history__item-row">
                      <span className="bob-conv-history__item-title">{conversation.title}</span>
                      <span className="bob-conv-history__item-time">
                        {relativeTime(conversation.updatedAt, now)}
                      </span>
                    </span>
                    {conversation.preview ? (
                      <span className="bob-conv-history__item-preview">{conversation.preview}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="bob-conv-history__footer">
            <button
              type="button"
              className="bob-conv-history__action"
              onClick={() => {
                setOpen(false);
                onNewChat();
              }}
            >
              <Add size={16} aria-hidden />
              <span>New chat</span>
            </button>
            <button
              type="button"
              className="bob-conv-history__action"
              onClick={() => {
                setOpen(false);
                onShowAll();
              }}
            >
              <ListBoxes size={16} aria-hidden />
              <span>All conversations</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
