import type { ConversationSummary } from "../../lib/ipc/conversationsClient";
import { ConversationActionsMenu, type ConversationActions } from "./ConversationActionsMenu";
import { relativeTime } from "./conversationView";

/**
 * One row in the sidebar Chat tab's conversation list: just the conversation
 * title (the truncated first user message, one line with ellipsis) and a
 * relative timestamp, with the per-conversation ⋮ actions menu on the trailing
 * edge. Clicking the body opens the conversation.
 *
 * Deliberately lean — the preview snippet, attached-file chips, and message
 * count were dropped to keep the row to a single uncluttered line (the
 * all-conversations overlay that wanted the fuller meta block is gone, so the
 * sidebar is the only caller).
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
      <ConversationActionsMenu archived={conversation.archived} actions={actions} align="end" />
    </li>
  );
}
