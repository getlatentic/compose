import { describe, expect, it } from "vitest";
import { renderMarkdownPreview } from "./markdownPipeline";

describe("renderMarkdownPreview", () => {
  it("returns sanitized HAST metadata for Markdown", async () => {
    const preview = await renderMarkdownPreview(`# Launch

Body copy with **strong** text.

<script>alert("blocked")</script>

## Next steps
`);

    expect(preview.meta.headings).toEqual([
      { depth: 1, text: "Launch" },
      { depth: 2, text: "Next steps" },
    ]);
    expect(preview.meta.wordCount).toBe(8);
    expect(JSON.stringify(preview.tree)).not.toContain("script");
  });
});
