import { useMemo } from "react";

import { useWorkspaceStore } from "../../app/workspaceStore";
import type { ConversationSummary } from "../../lib/ipc/conversationsClient";
import { ConversationListRow } from "./ConversationListRow";
import { filterConversations, groupConversationsByDate } from "./conversationView";
import { useConversationRowActions } from "./useConversationRowActions";

/**
 * The sidebar Chat tab's conversation list: this folder's active (non-archived)
 * conversations, grouped into date sections (Today / Yesterday / Last 7 days /
 * Older) and rendered with the shared {@link ConversationListRow} — the same
 * row the all-conversations view uses. Clicking a row opens it in the chat
 * pane (revealing the pane if hidden) and pulses its border; the per-row ⋮ menu
 * reuses {@link useConversationRowActions}.
 *
 * Driven entirely by the store (`conversations[activeWorkspaceId]`), so it
 * stays in sync as conversations are created, renamed, or deleted.
 */
export function SidebarChatList() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const conversationsByWorkspace = useWorkspaceStore((state) => state.conversations);
  const openConversationFromSidebar = useWorkspaceStore(
    (state) => state.openConversationFromSidebar,
  );
  const makeActions = useConversationRowActions();

  const conversations: ConversationSummary[] = activeWorkspaceId
    ? conversationsByWorkspace[activeWorkspaceId] ?? []
    : [];

  // The sidebar shows only active (non-archived) conversations. `now` is
  // captured per render — date bucketing only needs day-level resolution.
  const now = Date.now();
  const sections = useMemo(
    () =>
      groupConversationsByDate(
        filterConversations(conversations, { query: "", archived: false, mentionsFile: null }),
        now,
      ),
    [conversations, now],
  );

  if (sections.length === 0) {
    return (
      <div className="bob-sidebar-chat__empty">
        <p>No conversations yet.</p>
        <p>Start one with “New chat”.</p>
      </div>
    );
  }

  return (
    <div className="bob-sidebar-chat" aria-label="Conversations">
      {sections.map((section) => (
        <section key={section.group} className="bob-sidebar-chat__section">
          <h4 className="bob-sidebar-chat__section-title">{section.group}</h4>
          <ul className="bob-sidebar-chat__list">
            {section.conversations.map((conversation) => (
              <ConversationListRow
                key={conversation.conversationId}
                conversation={conversation}
                now={now}
                onOpen={(id) => void openConversationFromSidebar(id)}
                actions={makeActions(conversation)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
