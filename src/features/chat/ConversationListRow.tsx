import type { ConversationSummary } from "../../lib/ipc/conversationsClient";
import { ConversationActionsMenu, type ConversationActions } from "./ConversationActionsMenu";

/**
 * One row in the sidebar Chat tab's conversation list: the conversation title
 * (the truncated first user message, one line with ellipsis), with the
 * per-conversation ⋮ actions menu on the trailing edge on HOVER / focus / when
 * the menu is open. Mirrors Claude's row pattern — the row stays quiet until you
 * interact with it, and there's no per-row timestamp (the Today / Yesterday /
 * … date groups already place each chat in time). Clicking the body opens the
 * conversation.
 *
 * The actions' visibility swap is CSS-only (see `.conv-row` in global.scss).
 */
export function ConversationListRow({
  conversation,
  onOpen,
  actions,
}: {
  conversation: ConversationSummary;
  onOpen: (conversationId: string) => void;
  actions: ConversationActions;
}) {
  return (
    <li className="conv-row">
      <button
        type="button"
        className="conv-row__main"
        onClick={() => onOpen(conversation.conversationId)}
      >
        <span className="conv-row__title">{conversation.title}</span>
      </button>
      <span className="conv-row__actions">
        <ConversationActionsMenu archived={conversation.archived} actions={actions} align="end" />
      </span>
    </li>
  );
}
