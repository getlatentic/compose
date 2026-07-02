import { describe, expect, it } from "vitest";

import { formatExcerptPreamble, parseExcerptPreamble } from "./excerptPreamble";

describe("excerptPreamble", () => {
  it("round-trips the file path and a markdown-blockquote body", () => {
    const content = formatExcerptPreamble({
      filePath: "Others/Writing/data-science-nigeria-video.md",
      text: "Hi, I'm Tosin.\nSecond line.",
      note: "is this relevant?",
    });
    const parsed = parseExcerptPreamble(content);
    expect(parsed?.path).toBe("Others/Writing/data-science-nigeria-video.md");
    // The body is the selection as a blockquote, then the note — ready for the
    // markdown renderer.
    expect(parsed?.body).toBe("> Hi, I'm Tosin.\n> Second line.\n\nis this relevant?");
  });

  it("returns null for a message that isn't a commented excerpt", () => {
    expect(parseExcerptPreamble("Just a normal question?")).toBeNull();
  });
});
