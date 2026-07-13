import { afterEach, describe, expect, it, vi } from "vitest";

const editor = vi.hoisted(() => ({
  getCachedMermaidPng: vi.fn(),
  warmMermaidPng: vi.fn(async () => {}),
  highlightFenceSpans: vi.fn(),
}));
vi.mock("ai-editor", () => editor);

import { markdownToClipboardHtml } from "./markdownToClipboardHtml";

afterEach(() => vi.clearAllMocks());

const MERMAID_DOC = "```mermaid\nflowchart TD\n  A --> B\n```";

describe("clipboard enrichment — mermaid", () => {
  it("embeds a warmed diagram as a PNG image in place of the code block", () => {
    editor.getCachedMermaidPng.mockReturnValue("data:image/png;base64,AAA");
    const html = markdownToClipboardHtml(MERMAID_DOC);
    expect(html).toContain('<img src="data:image/png;base64,AAA"');
    expect(html).toContain('alt="Mermaid diagram"');
    expect(html).not.toContain("<pre>");
    expect(editor.getCachedMermaidPng).toHaveBeenCalledWith("flowchart TD\n  A --> B\n");
  });

  it("keeps the source block on a cold cache and warms it for the next copy", () => {
    editor.getCachedMermaidPng.mockReturnValue(null);
    const html = markdownToClipboardHtml(MERMAID_DOC);
    expect(html).toContain("flowchart TD");
    expect(html).toContain("<pre>");
    expect(html).not.toContain("<img");
    expect(editor.warmMermaidPng).toHaveBeenCalledOnce();
  });
});

describe("clipboard enrichment — code highlighting", () => {
  it("replaces code text with inline-styled spans when the grammar is warm", () => {
    editor.highlightFenceSpans.mockReturnValue([
      { text: "const", style: "color:#a626a4" },
      { text: " x" },
    ]);
    const html = markdownToClipboardHtml("```js\nconst x\n```");
    expect(html).toContain('<span style="color:#a626a4">const</span>');
    expect(editor.highlightFenceSpans).toHaveBeenCalledWith("js", "const x");
  });

  it("leaves the block plain when no highlighting is available", () => {
    editor.highlightFenceSpans.mockReturnValue(null);
    const html = markdownToClipboardHtml("```js\nconst x\n```");
    expect(html).toContain("const x");
    expect(html).not.toContain("<span");
  });

  it("does not touch language-less blocks or prose", () => {
    const html = markdownToClipboardHtml("```\nplain\n```\n\n**bold**");
    expect(editor.highlightFenceSpans).not.toHaveBeenCalled();
    expect(html).toContain("plain");
    expect(html).toContain("<strong>bold</strong>");
  });
});
