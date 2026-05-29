import type { Root } from "hast";

export interface MarkdownPreviewDocument {
  meta: {
    headings: MarkdownHeading[];
    wordCount: number;
  };
  tree: Root;
}

export interface MarkdownHeading {
  depth: number;
  text: string;
}
