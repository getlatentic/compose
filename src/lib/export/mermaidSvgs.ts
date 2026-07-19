import { isMermaidFenceInfo, renderMermaidToSvg } from "ai-editor";

import { createMarkdownProcessor } from "../markdown/processor";

/**
 * Pre-render the document's mermaid diagrams to SVG for export (#149).
 *
 * There is no Rust mermaid renderer, so the export backend can't turn a
 * ```mermaid fence into a diagram on its own. We render each fence here — with
 * the same `mermaid` the editor uses, so an already-shown diagram is a cache
 * hit — and hand the backend a `{ trimmed-source → svg }` map it inlines. A
 * fence that fails to render is simply absent from the map; the backend then
 * degrades it to its source, never a blank.
 *
 * Fences are discovered by PARSING the markdown (the app's single remark
 * pipeline), not by scanning lines — so closer length, indentation, and
 * nesting follow the same CommonMark grammar the export's comrak side uses,
 * and the `{source → svg}` keys can't diverge from what the backend looks up.
 */
export async function collectMermaidSvgs(markdown: string): Promise<Record<string, string>> {
  const sources = extractMermaidSources(markdown);
  // Built as a Map: bracket-assignment onto a plain object silently drops a
  // key like "__proto__" (it hits the prototype setter), and a diagram whose
  // source is exactly that would vanish from the export map.
  const svgs = new Map<string, string>();
  await Promise.all(
    sources.map(async (source) => {
      const result = await renderMermaidToSvg(source);
      if (result.ok) {
        svgs.set(source, result.svg);
      }
    }),
  );
  return Object.fromEntries(svgs);
}

interface MdastCode {
  type: string;
  lang?: string | null;
  meta?: string | null;
  value: string;
  position?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

/** The trimmed sources of the document's diagram fences, de-duplicated (two
 *  identical diagrams render once). Matches the editor's discovery: a bare
 *  `mermaid` tag (any casing, no meta), top-level and unindented, and CLOSED —
 *  an unterminated fence is still being typed and renders as source. */
function extractMermaidSources(markdown: string): string[] {
  const tree = createMarkdownProcessor().parse(markdown) as { children?: MdastCode[] };
  const sources = new Set<string>();
  for (const node of tree.children ?? []) {
    if (node.type !== "code" || !node.position) continue;
    if (node.position.start.column !== 1) continue;
    const info = [node.lang, node.meta].filter(Boolean).join(" ");
    if (!isMermaidFenceInfo(info)) continue;
    if (!fenceIsClosed(node)) continue;
    sources.add(node.value.trim());
  }
  return [...sources];
}

/** A closed fence spans its body plus the opener AND closer lines; an
 *  unterminated one ends on its last content line. */
function fenceIsClosed(node: MdastCode): boolean {
  if (!node.position) return false;
  const spanned = node.position.end.line - node.position.start.line + 1;
  const bodyLines = node.value === "" ? 0 : node.value.split("\n").length;
  return spanned >= bodyLines + 2;
}
