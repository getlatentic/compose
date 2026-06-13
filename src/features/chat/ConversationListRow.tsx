import type { ConversationSummary } from "../../lib/ipc/conversationsClient";
import { ConversationActionsMenu, type ConversationActions } from "./ConversationActionsMenu";
import { relativeTime } from "./conversationView";

/**
 * One row in the sidebar Chat tab's conversation list: just the conversation
 * title (the truncated first user message, one line with ellipsis), with the
 * relative time on the trailing edge AT REST and the per-conversation ⋮
 * actions menu in its place on HOVER / focus / when the menu is open. Mirrors
 * Claude's row pattern — the row stays quiet until you interact with it, so a
 * sidebar of 50 chats doesn't look like a wall of controls. Clicking the body
 * opens the conversation.
 *
 * The visibility swap is CSS-only (see `.bob-conv-row` in global.scss); the
 * markup is just title + time + actions, all always-rendered.
 */
export function ConversationListRow({
  conversation,
  now,
  onOpen,
  actions,
}: {
  conversation: ConversationSummary;
  now: number;
  onOpen: (conversationId: string) => void;
  actions: ConversationActions;
}) {
  return (
    <li className="bob-conv-row">
      <button
        type="button"
        className="bob-conv-row__main"
        onClick={() => onOpen(conversation.conversationId)}
      >
        <span className="bob-conv-row__head">
          <span className="bob-conv-row__title">{conversation.title}</span>
          <span className="bob-conv-row__time">{relativeTime(conversation.updatedAt, now)}</span>
        </span>
      </button>
      <span className="bob-conv-row__actions">
        <ConversationActionsMenu archived={conversation.archived} actions={actions} align="end" />
      </span>
    </li>
  );
}
