import { useMemo } from "react";

import { useWorkspaceStore } from "../../app/workspaceStore";
import type { ConversationSummary } from "../../lib/ipc/conversationsClient";
import { ConversationListRow } from "./ConversationListRow";
import { filterConversations, groupConversationsByDate } from "./conversationView";
import { useConversationRowActions } from "./useConversationRowActions";

/**
 * The sidebar Chat tab's conversation list. Two zones:
 *  - **Active** at the top, grouped into date sections (Today / Yesterday /
 *    Last 7 days / Older) — the normal browse surface.
 *  - **Archived** in a collapsed `<details>` at the bottom — so a chat the
 *    user once chose to archive remains *findable* (a previous redesign hid
 *    archived chats entirely, which made them impossible to recover from
 *    inside the app).
 *
 * Rows are the shared {@link ConversationListRow}; clicking opens the chat
 * pane and pulses its border; the per-row ⋮ menu reuses
 * {@link useConversationRowActions}. Driven entirely by the store
 * (`conversations[activeWorkspaceId]`), so it stays in sync as conversations
 * are created, renamed, archived, or deleted.
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

  // `now` is captured per render — date bucketing only needs day-level
  // resolution.
  const now = Date.now();
  const { activeSections, archived } = useMemo(() => {
    // Hide zero-message conversations from BOTH zones. An empty conversation
    // is a "start state" — the chat panel before you've sent anything — not a
    // history entry. Compose's runtime currently creates a row eagerly on
    // workspace open / chat-panel mount; those zombies were showing as
    // "New conversation" rows in the sidebar with no body, polluting the list
    // and crowding out real chats.
    const real = conversations.filter((c) => c.messageCount > 0);
    const active = filterConversations(real, {
      query: "",
      archived: false,
      mentionsFile: null,
    });
    const archivedList = filterConversations(real, {
      query: "",
      archived: true,
      mentionsFile: null,
    });
    return {
      activeSections: groupConversationsByDate(active, now),
      archived: archivedList,
    };
  }, [conversations, now]);

  if (activeSections.length === 0 && archived.length === 0) {
    return (
      <div className="sidebar-chat__empty">
        <p>No conversations yet.</p>
        <p>Start one with “New chat”.</p>
      </div>
    );
  }

  return (
    <div className="sidebar-chat" aria-label="Conversations">
      {activeSections.map((section) => (
        <section key={section.group} className="sidebar-chat__section">
          <h4 className="sidebar-chat__section-title">{section.group}</h4>
          <ul className="sidebar-chat__list">
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
      {archived.length > 0 ? (
        // Collapsed by default so it doesn't clutter the daily browse — the
        // disclosure triangle + count make it obvious the chats are still
        // here, just put aside.
        <details className="sidebar-chat__archived">
          <summary className="sidebar-chat__section-title">
            Archived ({archived.length})
          </summary>
          <ul className="sidebar-chat__list">
            {archived.map((conversation) => (
              <ConversationListRow
                key={conversation.conversationId}
                conversation={conversation}
                now={now}
                onOpen={(id) => void openConversationFromSidebar(id)}
                actions={makeActions(conversation)}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
