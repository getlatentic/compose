import { afterEach, describe, expect, it, vi } from "vitest";

const editor = vi.hoisted(() => ({ renderMermaidToSvg: vi.fn() }));
vi.mock("ai-editor", () => editor);

import { collectMermaidSvgs } from "./mermaidSvgs";

afterEach(() => vi.clearAllMocks());

describe("collectMermaidSvgs", () => {
  it("renders each closed mermaid fence, keyed by trimmed source", async () => {
    editor.renderMermaidToSvg.mockImplementation(async (source: string) => ({
      ok: true,
      svg: `<svg>${source.length}</svg>`,
    }));
    const md = "# Doc\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\ntext\n\n```mermaid\ngraph LR\n```\n";

    const svgs = await collectMermaidSvgs(md);

    expect(Object.keys(svgs).sort()).toEqual(["flowchart TD\n  A --> B", "graph LR"]);
    expect(svgs["graph LR"]).toBe("<svg>8</svg>");
  });

  it("omits fences that fail to render, so the backend falls back to source", async () => {
    editor.renderMermaidToSvg.mockResolvedValue({ ok: false, message: "parse error" });
    expect(await collectMermaidSvgs("```mermaid\nbad\n```")).toEqual({});
  });

  it("ignores non-mermaid code and unclosed fences", async () => {
    editor.renderMermaidToSvg.mockResolvedValue({ ok: true, svg: "<svg/>" });
    const svgs = await collectMermaidSvgs("```js\nconst x = 1\n```\n\n```mermaid\nunterminated");
    expect(svgs).toEqual({});
    expect(editor.renderMermaidToSvg).not.toHaveBeenCalled();
  });

  it("de-duplicates identical diagrams (renders once)", async () => {
    editor.renderMermaidToSvg.mockResolvedValue({ ok: true, svg: "<svg/>" });
    await collectMermaidSvgs("```mermaid\nA\n```\n\ntext\n\n```mermaid\nA\n```");
    expect(editor.renderMermaidToSvg).toHaveBeenCalledTimes(1);
  });

  it("recognizes the tilde fence and a case-varied info string", async () => {
    editor.renderMermaidToSvg.mockResolvedValue({ ok: true, svg: "<svg/>" });
    const svgs = await collectMermaidSvgs("~~~Mermaid\ngraph TD\n~~~");
    expect(svgs).toEqual({ "graph TD": "<svg/>" });
  });
});
