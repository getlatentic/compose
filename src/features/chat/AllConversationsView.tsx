import { useRef, useState } from "react";
import { Close, Search } from "@carbon/react/icons";

import type { ConversationSummary } from "../../lib/ipc/conversationsClient";
import { ConversationListRow } from "./ConversationListRow";
import { type ConversationActions } from "./ConversationActionsMenu";
import {
  filterConversations,
  groupConversationsByDate,
  type ConversationFilter,
} from "./conversationView";
import { useDismissableLayer } from "./useDismissableLayer";

type Pill = "all" | "mentions" | "archived";

/**
 * The full all-conversations view: an overlay panel over the chat with a
 * search box, filter pills (All / Mentions <active file> / Archived), and the
 * matching conversations grouped into date sections (Today / Yesterday / Last
 * 7 days / Older). Each row shows the title, preview, attached-file chips,
 * message count, and relative time, and opens the conversation on click.
 *
 * Pure and props-driven — the parent supplies the (already loaded) list and
 * the per-conversation action callbacks; this component owns only the
 * transient search / pill state. Escape closes it.
 */
export function AllConversationsView({
  conversations,
  activeFileLabel,
  now,
  onClose,
  onOpen,
  makeActions,
}: {
  conversations: ConversationSummary[];
  /** The open file's label, enabling the "Mentions <file>" pill, or null. */
  activeFileLabel: string | null;
  now: number;
  onClose: () => void;
  onOpen: (conversationId: string) => void;
  makeActions: (conversation: ConversationSummary) => ConversationActions;
}) {
  const [query, setQuery] = useState("");
  const [pill, setPill] = useState<Pill>("all");
  const rootRef = useRef<HTMLDivElement>(null);
  useDismissableLayer(true, onClose, rootRef);

  // The "Mentions" pill is only meaningful with a file open; fall back to
  // "All" so the active filter never points at a vanished file.
  const effectivePill: Pill = pill === "mentions" && !activeFileLabel ? "all" : pill;
  const filter: ConversationFilter = {
    query,
    archived: effectivePill === "archived",
    mentionsFile: effectivePill === "mentions" ? activeFileLabel : null,
  };
  const sections = groupConversationsByDate(filterConversations(conversations, filter), now);
  const isEmpty = sections.length === 0;

  const pills: { key: Pill; label: string }[] = [
    { key: "all", label: "All" },
    ...(activeFileLabel ? [{ key: "mentions" as Pill, label: `Mentions ${activeFileLabel}` }] : []),
    { key: "archived", label: "Archived" },
  ];

  return (
    <div className="bob-all-conv" ref={rootRef} role="dialog" aria-label="All conversations">
      <header className="bob-all-conv__header">
        <h3 className="bob-all-conv__title">Conversations</h3>
        <button
          type="button"
          className="bob-icon-button"
          aria-label="Close conversations"
          title="Close"
          onClick={onClose}
        >
          <Close size={16} />
        </button>
      </header>

      <div className="bob-all-conv__search">
        <Search size={16} aria-hidden />
        <input
          type="search"
          className="bob-all-conv__search-input"
          placeholder="Search conversations"
          aria-label="Search conversations"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="bob-all-conv__pills" role="tablist" aria-label="Filter conversations">
        {pills.map((option) => (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={effectivePill === option.key}
            className={[
              "bob-all-conv__pill",
              effectivePill === option.key ? "is-active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => setPill(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="bob-all-conv__body">
        {isEmpty ? (
          <p className="bob-all-conv__empty">
            {query.trim()
              ? "No conversations match your search."
              : effectivePill === "archived"
                ? "No archived conversations."
                : "No conversations yet."}
          </p>
        ) : (
          sections.map((section) => (
            <section key={section.group} className="bob-all-conv__section">
              <h4 className="bob-all-conv__section-title">{section.group}</h4>
              <ul className="bob-all-conv__list">
                {section.conversations.map((conversation) => (
                  <ConversationListRow
                    key={conversation.conversationId}
                    conversation={conversation}
                    now={now}
                    onOpen={onOpen}
                    actions={makeActions(conversation)}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
