import { afterEach, describe, expect, it, vi } from "vitest";

const editor = vi.hoisted(() => ({
  renderMermaidToSvg: vi.fn(),
  // Mirrors the real predicate's contract: bare tag, any casing, no meta.
  isMermaidFenceInfo: (info: string) => /^mermaid\s*$/i.test(info.trim()),
}));
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

  it("keeps the FULL body of a 4-backtick fence containing a bare ``` line", async () => {
    // CommonMark: a closer must be at least as long as its opener, so the
    // interior ``` is content — the svg key must be the whole body or the
    // backend lookup misses and the export degrades the diagram.
    editor.renderMermaidToSvg.mockResolvedValue({ ok: true, svg: "<svg/>" });
    const svgs = await collectMermaidSvgs("````mermaid\ngraph TD\n```\nmore\n````");
    expect(Object.keys(svgs)).toEqual(["graph TD\n```\nmore"]);
  });

  it("skips indented and container-nested fences, like the editor does", async () => {
    editor.renderMermaidToSvg.mockResolvedValue({ ok: true, svg: "<svg/>" });
    const indented = "    ```mermaid\n    graph TD\n    ```";
    const listed = "- item\n\n  ```mermaid\n  graph LR\n  ```";
    expect(await collectMermaidSvgs(indented)).toEqual({});
    expect(await collectMermaidSvgs(listed)).toEqual({});
    expect(editor.renderMermaidToSvg).not.toHaveBeenCalled();
  });

  it("skips a mermaid tag with trailing meta — the editor shows it as source", async () => {
    editor.renderMermaidToSvg.mockResolvedValue({ ok: true, svg: "<svg/>" });
    expect(await collectMermaidSvgs("```mermaid title=x\ngraph TD\n```")).toEqual({});
    expect(editor.renderMermaidToSvg).not.toHaveBeenCalled();
  });

  it("keeps a diagram whose source is __proto__ (no prototype-setter drop)", async () => {
    editor.renderMermaidToSvg.mockResolvedValue({ ok: true, svg: "<svg/>" });
    const svgs = await collectMermaidSvgs("```mermaid\n__proto__\n```");
    expect(Object.getOwnPropertyDescriptor(svgs, "__proto__")?.value).toBe("<svg/>");
  });
});
