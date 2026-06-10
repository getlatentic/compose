import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ChatEmptyState } from "./ChatEmptyState";

describe("ChatEmptyState", () => {
  it("names the context file and offers file-specific prompts", () => {
    const html = renderToStaticMarkup(
      <ChatEmptyState contextFileLabel="Q3 field notes.md" onUseSuggestion={() => {}} />,
    );
    expect(html).toContain("New conversation");
    expect(html).toContain("Q3 field notes.md");
    expect(html).toContain("the file you"); // "the file you're viewing"
    expect(html).toContain("Summarize this file");
  });

  it("falls back to workspace prompts when no file is in context", () => {
    const html = renderToStaticMarkup(
      <ChatEmptyState contextFileLabel={null} onUseSuggestion={() => {}} />,
    );
    expect(html).toContain("New conversation");
    expect(html).not.toContain("the file you"); // the file line is omitted
    expect(html).toContain("What can you help me with?");
  });
});
