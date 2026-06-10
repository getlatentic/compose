import { Document } from "@carbon/react/icons";

import type { ConversationSummary } from "../../lib/ipc/conversationsClient";
import { ConversationActionsMenu, type ConversationActions } from "./ConversationActionsMenu";
import { relativeTime } from "./conversationView";

/**
 * One row in the all-conversations view: the title + relative time, a preview
 * snippet, then a meta line of attached-file chips and the message count, with
 * the per-conversation ⋮ actions menu on the trailing edge. Clicking the body
 * opens the conversation.
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
  const count = conversation.messageCount;
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
        {conversation.preview ? (
          <span className="bob-conv-row__preview">{conversation.preview}</span>
        ) : null}
        <span className="bob-conv-row__meta">
          {conversation.contextFiles.map((file) => (
            <span key={file} className="bob-conv-chip" title={file}>
              <Document size={12} aria-hidden />
              <span className="bob-conv-chip__label">{file}</span>
            </span>
          ))}
          <span className="bob-conv-row__count">
            {count} {count === 1 ? "message" : "messages"}
          </span>
        </span>
      </button>
      <ConversationActionsMenu archived={conversation.archived} actions={actions} align="end" />
    </li>
  );
}
