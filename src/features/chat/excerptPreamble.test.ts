import { describe, expect, it } from "vitest";

import { formatExcerptPreamble, parseExcerptPreamble } from "./excerptPreamble";

describe("excerptPreamble", () => {
  it("round-trips the file path, the blockquote, and the note separately", () => {
    const content = formatExcerptPreamble({
      filePath: "Others/Writing/data-science-nigeria-video.md",
      text: "Hi, I'm Tosin.\nSecond line.",
      note: "is this relevant?",
    });
    const parsed = parseExcerptPreamble(content);
    expect(parsed?.path).toBe("Others/Writing/data-science-nigeria-video.md");
    // The excerpt is a markdown blockquote; the note is kept apart so the card
    // can clamp the quote without ever hiding the comment.
    expect(parsed?.quote).toBe("> Hi, I'm Tosin.\n> Second line.");
    expect(parsed?.note).toBe("is this relevant?");
  });

  it("keeps a blank line inside the selection with the quote, not the note", () => {
    const content = formatExcerptPreamble({
      filePath: "a.md",
      text: "First para.\n\nSecond para.",
      note: "my note",
    });
    const parsed = parseExcerptPreamble(content);
    // The blank source line becomes a `> ` line, so it stays in the quote — the
    // note boundary is the blank line after the whole blockquote.
    expect(parsed?.quote).toBe("> First para.\n> \n> Second para.");
    expect(parsed?.note).toBe("my note");
  });

  it("returns null for a message that isn't a commented excerpt", () => {
    expect(parseExcerptPreamble("Just a normal question?")).toBeNull();
  });
});
