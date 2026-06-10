import { describe, expect, it } from "vitest";

import { conversationToMarkdown } from "./conversationMarkdown";

describe("conversationToMarkdown", () => {
  it("renders a titled transcript with You / Assistant sections", () => {
    const markdown = conversationToMarkdown("Relocation plan", [
      { role: "user", content: "Where should we move?" },
      { role: "assistant", content: "Consider Austin or Denver." },
    ]);
    expect(markdown).toBe(
      "# Relocation plan\n\n" +
        "## You\n\nWhere should we move?\n\n" +
        "## Assistant\n\nConsider Austin or Denver.\n",
    );
  });

  it("skips empty messages and falls back to a default heading", () => {
    const markdown = conversationToMarkdown("  ", [
      { role: "user", content: "   " },
      { role: "assistant", content: "Only this." },
    ]);
    expect(markdown).toContain("# New conversation");
    expect(markdown).toContain("## Assistant\n\nOnly this.");
    expect(markdown).not.toContain("## You");
  });
});
