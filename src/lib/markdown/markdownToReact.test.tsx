import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { renderMarkdownToReact } from "./markdownToReact";

/** Render the markdown→React tree to a static HTML string so we can
 * assert structure + sanitization without a DOM. */
function toHtml(markdown: string): string {
  return renderToStaticMarkup(<>{renderMarkdownToReact(markdown)}</>);
}

describe("renderMarkdownToReact", () => {
  it("renders inline and block markdown as React elements", () => {
    const html = toHtml("Body with **strong** and `code`.\n\n- one\n- two");
    expect(html).toContain("<strong>strong</strong>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });

  it("renders fenced code blocks as pre > code", () => {
    const html = toHtml("```\nconst x = 1;\n```");
    expect(html).toContain("<pre>");
    expect(html).toContain("const x = 1;");
  });

  it("strips disallowed HTML through the shared rehype-sanitize boundary", () => {
    const html = toHtml('Hello <script>alert("x")</script> world');
    expect(html).not.toContain("<script");
    expect(html).toContain("Hello");
    expect(html).toContain("world");
  });

  it("honors single newlines as hard line breaks (chat convention)", () => {
    const html = toHtml("Line one\nLine two");
    expect(html).toContain("<br");
    // And does not split inside a fenced code block.
    const code = toHtml("```\nline a\nline b\n```");
    expect(code).not.toContain("<br");
    expect(code).toContain("line a");
    expect(code).toContain("line b");
  });
});
