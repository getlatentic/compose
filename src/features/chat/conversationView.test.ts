import { describe, expect, it } from "vitest";

import type { ConversationSummary } from "../../lib/ipc/conversationsClient";
import {
  conversationDateGroup,
  filterConversations,
  groupConversationsByDate,
  recentConversations,
  relativeTime,
} from "./conversationView";

function summary(overrides: Partial<ConversationSummary>): ConversationSummary {
  return {
    conversationId: overrides.conversationId ?? `c-${overrides.title ?? "x"}`,
    title: "Untitled",
    harnessId: "bob",
    createdAt: 0,
    updatedAt: 0,
    messageCount: 1,
    preview: "",
    archived: false,
    contextFiles: [],
    ...overrides,
  };
}

const NOON = new Date(2026, 5, 9, 12, 0, 0).getTime();

describe("conversationDateGroup", () => {
  it("buckets by local calendar day", () => {
    expect(conversationDateGroup(NOON, NOON)).toBe("Today");
    expect(conversationDateGroup(new Date(2026, 5, 8, 15).getTime(), NOON)).toBe("Yesterday");
    expect(conversationDateGroup(new Date(2026, 5, 5, 9).getTime(), NOON)).toBe("Last 7 days");
    expect(conversationDateGroup(new Date(2026, 5, 1, 9).getTime(), NOON)).toBe("Older");
  });
});

describe("relativeTime", () => {
  it("renders compact 'ago' labels with a date fallback", () => {
    expect(relativeTime(NOON, NOON)).toBe("just now");
    expect(relativeTime(NOON - 5 * 60_000, NOON)).toBe("5m ago");
    expect(relativeTime(NOON - 3 * 3_600_000, NOON)).toBe("3h ago");
    expect(relativeTime(NOON - 2 * 86_400_000, NOON)).toBe("2d ago");
    expect(relativeTime(NOON - 3 * 7 * 86_400_000, NOON)).toBe("3w ago");
    // Past ~5 weeks it falls back to a short date, not a "w ago" label.
    expect(relativeTime(NOON - 60 * 86_400_000, NOON)).not.toContain("ago");
  });
});

describe("filterConversations", () => {
  const list = [
    summary({ conversationId: "a", title: "Relocation plan", preview: "move offices" }),
    summary({ conversationId: "b", title: "Budget", contextFiles: ["budget.md"] }),
    summary({ conversationId: "c", title: "Old idea", archived: true }),
  ];

  it("hides archived under the active filter and shows them under archived", () => {
    const active = filterConversations(list, { query: "", archived: false, mentionsFile: null });
    expect(active.map((c) => c.conversationId)).toEqual(["a", "b"]);
    const archived = filterConversations(list, { query: "", archived: true, mentionsFile: null });
    expect(archived.map((c) => c.conversationId)).toEqual(["c"]);
  });

  it("matches the query across title, preview, and file chips", () => {
    expect(
      filterConversations(list, { query: "offices", archived: false, mentionsFile: null }).map(
        (c) => c.conversationId,
      ),
    ).toEqual(["a"]);
    expect(
      filterConversations(list, { query: "budget.md", archived: false, mentionsFile: null }).map(
        (c) => c.conversationId,
      ),
    ).toEqual(["b"]);
  });

  it("keeps only conversations that mention the named file", () => {
    expect(
      filterConversations(list, { query: "", archived: false, mentionsFile: "budget.md" }).map(
        (c) => c.conversationId,
      ),
    ).toEqual(["b"]);
  });
});

describe("groupConversationsByDate", () => {
  it("orders sections and preserves input order within them", () => {
    const sections = groupConversationsByDate(
      [
        summary({ conversationId: "t1", updatedAt: NOON }),
        summary({ conversationId: "t2", updatedAt: NOON - 60_000 }),
        summary({ conversationId: "old", updatedAt: new Date(2026, 5, 1).getTime() }),
      ],
      NOON,
    );
    expect(sections.map((s) => s.group)).toEqual(["Today", "Older"]);
    expect(sections[0].conversations.map((c) => c.conversationId)).toEqual(["t1", "t2"]);
  });
});

describe("recentConversations", () => {
  it("drops archived and caps the count", () => {
    const list = [
      summary({ conversationId: "a" }),
      summary({ conversationId: "b", archived: true }),
      summary({ conversationId: "c" }),
    ];
    expect(recentConversations(list, 1).map((c) => c.conversationId)).toEqual(["a"]);
    expect(recentConversations(list, 5).map((c) => c.conversationId)).toEqual(["a", "c"]);
  });
});
