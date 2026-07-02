import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Isolate the card from the markdown renderer (its own concern, tested apart):
// the mock echoes the body so the card's structure is what's under test.
vi.mock("./MarkdownMessage", () => ({
  MarkdownMessage: ({ content }: { content: string }) => <div className="markdown">{content}</div>,
}));

import { ExcerptCard } from "./ExcerptCard";
import { formatExcerptPreamble } from "./excerptPreamble";

const shortContent = formatExcerptPreamble({
  filePath: "Others/Writing/data-science-nigeria-video.md",
  text: "Hi, I'm Tosin.",
  note: "relevant?",
});

describe("ExcerptCard", () => {
  it("shows the file name in the header, full path on hover, line only when given", () => {
    const withLine = renderToStaticMarkup(
      <ExcerptCard content={shortContent} line={39} column={1} />,
    );
    // Basename is the visible label; the full path lives only in the hover title.
    expect(withLine).toContain(">data-science-nigeria-video.md</span>");
    expect(withLine).toContain('title="Others/Writing/data-science-nigeria-video.md"');
    expect(withLine).not.toContain(">Others/Writing/data-science-nigeria-video.md</span>");
    expect(withLine).toContain("L39:C1");

    // A legacy message (no persisted line) renders the same card, no line badge.
    const noLine = renderToStaticMarkup(<ExcerptCard content={shortContent} />);
    expect(noLine).toContain(">data-science-nigeria-video.md</span>");
    expect(noLine).not.toContain("excerpt-card__loc");
  });

  it("clamps a long excerpt behind Show more but always keeps the note visible", () => {
    const longContent = formatExcerptPreamble({
      filePath: "a.md",
      text: Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n"),
      note: "still relevant?",
    });
    const longHtml = renderToStaticMarkup(<ExcerptCard content={longContent} />);
    expect(longHtml).toContain("excerpt-card__excerpt--clamped");
    expect(longHtml).toContain("Show more");
    // The note lives outside the clamp — never hidden behind "Show more".
    expect(longHtml).toContain("excerpt-card__note");
    expect(longHtml).toContain("still relevant?");

    const shortHtml = renderToStaticMarkup(<ExcerptCard content={shortContent} />);
    expect(shortHtml).not.toContain("excerpt-card__excerpt--clamped");
    expect(shortHtml).not.toContain("Show more");
  });
});
