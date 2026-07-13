import { getCachedMermaidPng, highlightFenceSpans, warmMermaidPng } from "ai-editor";

/**
 * Enrich the clipboard's sanitized hast tree so a copy keeps its richness in
 * Docs/Word (#149): code fences get inline-styled highlight spans, mermaid
 * fences become the rendered diagram as a PNG `<img>`.
 *
 * Runs AFTER `rehype-sanitize`, deliberately: sanitize strips `style`
 * attributes and `data:` image sources, which is exactly what these
 * enrichments are made of. That stays sound because nothing user-authored is
 * injected — the span styles come from a fixed palette and the image bytes
 * from our own mermaid render of the (already sanitized) fence text.
 *
 * The copy event writes the clipboard synchronously, so both enrichments are
 * cache-reads: a diagram the editor has shown has a warm PNG; a fence the
 * editor has shown has a warm grammar. A cold one degrades to the plain code
 * block and warms itself for the next copy.
 */

interface HastText {
  type: "text";
  value: string;
}

interface HastElement {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastNode[];
}

type HastNode = { type: string; children?: HastNode[] } | HastElement | HastText;

export function enrichClipboardTree(tree: { children?: HastNode[] }): void {
  visitChildren(tree as { children?: HastNode[] });
}

function visitChildren(parent: { children?: HastNode[] }): void {
  const children = parent.children;
  if (!children) return;
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index];
    if (!isElement(node)) continue;
    if (node.tagName === "pre") {
      const replacement = enrichCodeBlock(node);
      if (replacement) {
        children[index] = replacement;
        continue;
      }
    }
    visitChildren(node);
  }
}

/** Returns a replacement node for the whole `<pre>`, or null to keep it
 *  (possibly after mutating the code's children in place). */
function enrichCodeBlock(pre: HastElement): HastElement | null {
  const code = pre.children.find(
    (child): child is HastElement => isElement(child) && child.tagName === "code",
  );
  if (!code) return null;
  const lang = languageOf(code);
  if (!lang) return null;
  const source = textOf(code);

  if (lang === "mermaid") {
    const png = getCachedMermaidPng(source);
    if (png) {
      return {
        type: "element",
        tagName: "img",
        properties: { src: png, alt: "Mermaid diagram", style: "max-width:100%" },
        children: [],
      };
    }
    void warmMermaidPng(source);
    return null;
  }

  const spans = highlightFenceSpans(lang, source.replace(/\n$/, ""));
  if (spans) {
    code.children = spans.map((span) =>
      span.style
        ? {
            type: "element",
            tagName: "span",
            properties: { style: span.style },
            children: [{ type: "text", value: span.text }],
          }
        : { type: "text", value: span.text },
    );
  }
  return null;
}

function isElement(node: HastNode): node is HastElement {
  return node.type === "element";
}

function languageOf(code: HastElement): string | null {
  const classes = code.properties?.className;
  if (!Array.isArray(classes)) return null;
  for (const cls of classes) {
    const name = String(cls);
    if (name.startsWith("language-")) return name.slice("language-".length).toLowerCase();
  }
  return null;
}

function textOf(node: HastNode): string {
  if (node.type === "text") return (node as HastText).value;
  const children = (node as { children?: HastNode[] }).children ?? [];
  return children.map(textOf).join("");
}
