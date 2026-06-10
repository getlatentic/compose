import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ConversationSummary } from "../../lib/ipc/conversationsClient";
import { AllConversationsView } from "./AllConversationsView";

function summary(overrides: Partial<ConversationSummary>): ConversationSummary {
  return {
    conversationId: overrides.conversationId ?? "c1",
    title: "Untitled",
    harnessId: "bob",
    createdAt: 0,
    updatedAt: 0,
    messageCount: 2,
    preview: "",
    archived: false,
    contextFiles: [],
    ...overrides,
  };
}

const NOON = new Date(2026, 5, 9, 12, 0, 0).getTime();
const noop = () => {};
const noActions = () => ({
  onRename: noop,
  onDuplicate: noop,
  onExport: noop,
  onArchive: noop,
  onDelete: noop,
});

describe("AllConversationsView", () => {
  it("shows active conversations under the default All filter and hides archived", () => {
    const html = renderToStaticMarkup(
      <AllConversationsView
        conversations={[
          summary({ conversationId: "a", title: "Relocation plan", updatedAt: NOON }),
          summary({ conversationId: "b", title: "Old idea", archived: true, updatedAt: NOON }),
        ]}
        activeFileLabel={null}
        now={NOON}
        onClose={noop}
        onOpen={noop}
        makeActions={noActions}
      />,
    );
    expect(html).toContain("Conversations");
    expect(html).toContain("Relocation plan");
    expect(html).not.toContain("Old idea");
    // Date section heading present for today's activity.
    expect(html).toContain("Today");
  });

  it("offers the Mentions pill and renders file chips + message counts", () => {
    const html = renderToStaticMarkup(
      <AllConversationsView
        conversations={[
          summary({
            conversationId: "a",
            title: "Budget",
            contextFiles: ["budget.md"],
            messageCount: 1,
            updatedAt: NOON,
          }),
        ]}
        activeFileLabel="budget.md"
        now={NOON}
        onClose={noop}
        onOpen={noop}
        makeActions={noActions}
      />,
    );
    expect(html).toContain("Mentions budget.md");
    expect(html).toContain("budget.md");
    expect(html).toContain("1 message");
  });

  it("renders no Mentions pill without an open file", () => {
    const html = renderToStaticMarkup(
      <AllConversationsView
        conversations={[summary({ title: "Solo", updatedAt: NOON })]}
        activeFileLabel={null}
        now={NOON}
        onClose={noop}
        onOpen={noop}
        makeActions={noActions}
      />,
    );
    expect(html).not.toContain("Mentions");
  });
});
