import type { ConversationSummary } from "../../lib/ipc/conversationsClient";

/**
 * Pure presentation helpers for the conversation history surfaces — relative
 * time, date bucketing, search / filter, and section grouping. Kept free of
 * React and the store so they are cheap to unit-test and reusable across the
 * history dropdown and the all-conversations view.
 */

export type ConversationDateGroup = "Today" | "Yesterday" | "Last 7 days" | "Older";

const DAY_MS = 86_400_000;
const GROUP_ORDER: ConversationDateGroup[] = ["Today", "Yesterday", "Last 7 days", "Older"];

/** Local-time start-of-day for a timestamp. */
function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Which date section a conversation's last activity falls into. */
export function conversationDateGroup(updatedAt: number, now: number): ConversationDateGroup {
  const today = startOfDay(now);
  const day = startOfDay(updatedAt);
  if (day >= today) {
    return "Today";
  }
  if (day >= today - DAY_MS) {
    return "Yesterday";
  }
  if (day > today - 7 * DAY_MS) {
    return "Last 7 days";
  }
  return "Older";
}

/** A compact "x ago" label, falling back to a short date past a few weeks. */
export function relativeTime(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  if (diff < 60_000) {
    return "just now";
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(diff / DAY_MS);
  if (days < 7) {
    return `${days}d ago`;
  }
  const weeks = Math.floor(days / 7);
  if (weeks < 5) {
    return `${weeks}w ago`;
  }
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export interface ConversationFilter {
  /** Free-text query matched against title / preview / file chips. */
  query: string;
  /** Show archived conversations instead of active ones. */
  archived: boolean;
  /** When set, keep only conversations whose context files include this label. */
  mentionsFile: string | null;
}

/** Apply the all-conversations view's search box + filter pills. */
export function filterConversations(
  conversations: ConversationSummary[],
  filter: ConversationFilter,
): ConversationSummary[] {
  const query = filter.query.trim().toLowerCase();
  return conversations.filter((conversation) => {
    if (filter.archived ? !conversation.archived : conversation.archived) {
      return false;
    }
    if (filter.mentionsFile && !conversation.contextFiles.includes(filter.mentionsFile)) {
      return false;
    }
    if (query) {
      const haystack = `${conversation.title} ${conversation.preview} ${conversation.contextFiles.join(
        " ",
      )}`.toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    return true;
  });
}

export interface ConversationSection {
  group: ConversationDateGroup;
  conversations: ConversationSummary[];
}

/** Bucket conversations (assumed already sorted newest-first) into date
 * sections, preserving order within each and dropping empty sections. */
export function groupConversationsByDate(
  conversations: ConversationSummary[],
  now: number,
): ConversationSection[] {
  const buckets = new Map<ConversationDateGroup, ConversationSummary[]>();
  for (const conversation of conversations) {
    const group = conversationDateGroup(conversation.updatedAt, now);
    const list = buckets.get(group);
    if (list) {
      list.push(conversation);
    } else {
      buckets.set(group, [conversation]);
    }
  }
  return GROUP_ORDER.filter((group) => buckets.has(group)).map((group) => ({
    group,
    conversations: buckets.get(group) ?? [],
  }));
}
