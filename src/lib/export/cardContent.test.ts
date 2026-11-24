import { describe, expect, it } from "vitest";

import { cardContentFor } from "./cardContent";

describe("cardContentFor", () => {
  it("takes the card's words from the note's front matter", () => {
    const note = [
      "---",
      "category: Graduate Mathematics",
      "title: Alpöge-Claude-Riemann Theorem",
      "author: [GPT-6.2 Astra]",
      "description: Prime sums, theta lifts, and zeros of Dirichlet L-functions",
      "date: 2026-03-14",
      "---",
      "# Something else",
      "",
      "The *first* paragraph.",
    ].join("\n");
    expect(cardContentFor(note, "notes/theorem.md")).toMatchObject({
      eyebrow: "Graduate Mathematics",
      title: "Alpöge-Claude-Riemann Theorem",
      author: "GPT-6.2 Astra",
      subtitle: "Prime sums, theta lifts, and zeros of Dirichlet L-functions",
      date: "2026",
      quote: "The first paragraph.",
    });
  });

  it("falls back to the first heading, then the file name, and leaves the rest empty", () => {
    expect(cardContentFor("## Method\n\nText.", "a.md")).toMatchObject({ title: "Method", eyebrow: "", author: "" });
    expect(cardContentFor("Just prose.", "notes/Plan for May.md").title).toBe("Plan for May");
  });

  it("quotes the selection when there is one, as plain words", () => {
    expect(cardContentFor("# T\n\nOther.", "a.md", "We **recruited**\nnurses by [purposive](x) sampling").quote).toBe(
      "We recruited nurses by purposive sampling",
    );
  });

  it("skips headings, lists and fences when it looks for a paragraph to quote", () => {
    expect(cardContentFor("# T\n\n- a list\n\n```\ncode\n```\n\nThe real one.", "a.md").quote).toBe("The real one.");
  });
});
