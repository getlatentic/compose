// The clipboard HTML renderer (#135): built on the app's single sanitized
// pipeline, so what lands in Docs/Slack is exactly the grammar the app
// renders everywhere else.
import { describe, expect, it } from "vitest";

import { markdownToClipboardHtml } from "./markdownToClipboardHtml";

describe("markdownToClipboardHtml", () => {
  it("renders headings, emphasis, and links", () => {
    const html = markdownToClipboardHtml("# Title\n\nSome **bold** and a [link](https://x.y).");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://x.y">link</a>');
  });

  it("renders GFM tables as real <table> markup (what Docs/Slack paste formatted)", () => {
    const html = markdownToClipboardHtml("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>a</th>");
    expect(html).toContain("<td>2</td>");
  });

  it("inherits the sanitize boundary — raw HTML in markdown cannot smuggle script", () => {
    const html = markdownToClipboardHtml("hello <script>alert(1)</script> world");
    expect(html).not.toContain("<script>");
  });
});
