import type { Element, Nodes, Root, Text } from "hast";
import { createMarkdownProcessor } from "../lib/markdown/processor";
import type { MarkdownHeading, MarkdownPreviewDocument } from "./shared/markdownTypes";

const processor = createMarkdownProcessor();

export async function renderMarkdownPreview(markdown: string): Promise<MarkdownPreviewDocument> {
  const markdownTree = processor.parse(markdown);
  const tree = (await processor.run(markdownTree)) as Root;
  const plainText = collectText(tree);

  return {
    meta: {
      headings: collectHeadings(tree),
      wordCount: countWords(plainText),
    },
    tree,
  };
}

function collectHeadings(root: Root): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];

  walk(root, (node) => {
    if (!isElement(node)) {
      return;
    }

    const depth = Number(node.tagName.replace("h", ""));
    if (node.tagName.match(/^h[1-6]$/) && Number.isInteger(depth)) {
      headings.push({
        depth,
        text: collectText(node).trim(),
      });
    }
  });

  return headings;
}

function collectText(node: Nodes): string {
  if (isText(node)) {
    return node.value;
  }

  if (!("children" in node)) {
    return "";
  }

  return node.children.map((child) => collectText(child)).join(" ");
}

function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

function walk(node: Nodes, visitor: (node: Nodes) => void) {
  visitor(node);

  if ("children" in node) {
    node.children.forEach((child) => walk(child, visitor));
  }
}

function isElement(node: Nodes): node is Element {
  return node.type === "element";
}

function isText(node: Nodes): node is Text {
  return node.type === "text";
}
