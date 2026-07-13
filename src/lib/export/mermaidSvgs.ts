import { renderMermaidToSvg } from "ai-editor";

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
 * The key is the fence's trimmed inner text, matching what the export renderer
 * keys on (comrak hands it the fence body; both sides trim).
 */
export async function collectMermaidSvgs(markdown: string): Promise<Record<string, string>> {
  const sources = extractMermaidSources(markdown);
  const svgs: Record<string, string> = {};
  await Promise.all(
    sources.map(async (source) => {
      const result = await renderMermaidToSvg(source);
      if (result.ok) {
        svgs[source] = result.svg;
      }
    }),
  );
  return svgs;
}

/** The trimmed sources of every CLOSED ```mermaid fence, de-duplicated (two
 *  identical diagrams render once). Only closed fences count — an unterminated
 *  fence is still being typed, exactly as the editor treats it. */
function extractMermaidSources(markdown: string): string[] {
  const lines = markdown.split("\n");
  const sources = new Set<string>();
  let index = 0;
  while (index < lines.length) {
    const opener = lines[index].match(/^\s*(`{3,}|~{3,})\s*mermaid\s*$/i);
    if (!opener) {
      index += 1;
      continue;
    }
    const fenceChar = opener[1][0];
    const closer = new RegExp(`^\\s*\\${fenceChar}{3,}\\s*$`);
    const body: string[] = [];
    index += 1;
    while (index < lines.length && !closer.test(lines[index])) {
      body.push(lines[index]);
      index += 1;
    }
    // Reached a real closer (not end-of-doc) → a closed fence.
    if (index < lines.length) {
      sources.add(body.join("\n").trim());
      index += 1;
    }
  }
  return [...sources];
}
