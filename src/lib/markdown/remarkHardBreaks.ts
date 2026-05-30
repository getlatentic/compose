import type { Plugin } from "unified";

/** The subset of an mdast node this transform touches. Declared locally
 * so the markdown core needs no `@types/mdast` dependency. */
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
}

/**
 * A dependency-free remark (mdast) transform that turns single newlines
 * into hard line breaks — the chat convention where Enter means a line
 * break, not a soft wrap that markdown collapses to a space. This is
 * exactly what `remark-breaks` does; it's inlined to avoid the dependency.
 *
 * Only `text` nodes are split, so fenced code (`code`) and inline code
 * (`inlineCode`) — distinct node types whose `value` is not a `text`
 * child — are left intact. Scoped to the chat processor via
 * `createMarkdownProcessor({ hardBreaks: true })`; the document preview
 * keeps standard markdown semantics.
 */
export const remarkHardBreaks: Plugin<[]> = () => (tree) => {
  splitTextNodes(tree as MdastNode);
};

function splitTextNodes(node: MdastNode): void {
  if (!node.children) {
    return;
  }
  const next: MdastNode[] = [];
  for (const child of node.children) {
    if (child.type === "text" && child.value && child.value.includes("\n")) {
      const segments = child.value.split("\n");
      segments.forEach((segment, index) => {
        if (segment) {
          next.push({ type: "text", value: segment });
        }
        if (index < segments.length - 1) {
          next.push({ type: "break" });
        }
      });
    } else {
      splitTextNodes(child);
      next.push(child);
    }
  }
  node.children = next;
}
