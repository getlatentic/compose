import { describe, expect, it } from "vitest";
import { renderMarkdownPreview } from "./markdownPipeline";

describe("renderMarkdownPreview", () => {
  it("extracts headings and a word count from markdown", async () => {
    const preview = await renderMarkdownPreview(`# Launch

Body copy with **strong** text.

<script>alert("blocked")</script>

## Next steps
`);

    expect(preview.meta.headings).toEqual([
      { depth: 1, text: "Launch" },
      { depth: 2, text: "Next steps" },
    ]);
    // "Launch" + "Body copy with strong text" (5) + "Next steps" (2) = 8.
    // The <script>...</script> block is stripped wholesale (HTML-block
    // regex), so its contents don't contribute to the count.
    expect(preview.meta.wordCount).toBe(8);
  });

  it("skips ATX-looking lines inside fenced code blocks", async () => {
    const preview = await renderMarkdownPreview(`# Real heading

\`\`\`md
# Not a heading
## Also not a heading
\`\`\`

## Another real heading
`);

    expect(preview.meta.headings).toEqual([
      { depth: 1, text: "Real heading" },
      { depth: 2, text: "Another real heading" },
    ]);
  });

  it("recognises setext-style headings", async () => {
    const preview = await renderMarkdownPreview(`Title One
=========

Body

Title Two
---------
`);

    expect(preview.meta.headings).toEqual([
      { depth: 1, text: "Title One" },
      { depth: 2, text: "Title Two" },
    ]);
  });

  it("strips inline markdown from heading text", async () => {
    const preview = await renderMarkdownPreview(`# **Bold** _and_ \`code\` and [link](url)`);

    expect(preview.meta.headings).toEqual([
      { depth: 1, text: "Bold and  and link" },
    ]);
  });

  it("keeps link text in the word count but drops the URL", async () => {
    const preview = await renderMarkdownPreview(
      `Check the [example link](https://example.com/very/long/path/that/should/not/count) here.`,
    );

    // Words: "Check", "the", "example", "link", "here." = 5. The URL is dropped.
    expect(preview.meta.wordCount).toBe(5);
  });
});
