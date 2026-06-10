import { describe, expect, it } from "vitest";
import { createMarkdownProcessor } from "./processor";

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { href?: string };
  children?: HastNode[];
}

function toHast(markdown: string): HastNode {
  const processor = createMarkdownProcessor({ wikilinks: true });
  return processor.runSync(processor.parse(markdown)) as unknown as HastNode;
}

function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

function collectLinks(node: HastNode, out: { href?: string; text: string }[] = []) {
  if (node.type === "element" && node.tagName === "a") {
    out.push({ href: node.properties?.href, text: textOf(node) });
  }
  for (const child of node.children ?? []) collectLinks(child, out);
  return out;
}

describe("remarkWikilink (chat)", () => {
  it("turns [[Note]] into a #wikilink: link (surviving sanitization)", () => {
    expect(collectLinks(toHast("see [[Note]]"))).toContainEqual({
      href: "#wikilink:Note",
      text: "Note",
    });
  });

  it("uses the alias as the visible text and the target in the href", () => {
    expect(collectLinks(toHast("[[Note|the note]]"))).toContainEqual({
      href: "#wikilink:Note",
      text: "the note",
    });
  });

  it("percent-encodes targets with spaces", () => {
    expect(collectLinks(toHast("[[Daily Note]]"))[0]?.href).toBe("#wikilink:Daily%20Note");
  });

  it("leaves [[…]] inside inline code untouched", () => {
    expect(collectLinks(toHast("`[[Note]]`"))).toHaveLength(0);
  });

  it("does not disturb a normal markdown link", () => {
    expect(collectLinks(toHast("[text](other.md)"))).toContainEqual({
      href: "other.md",
      text: "text",
    });
  });

  it("is off by default (document preview keeps [[…]] as text)", () => {
    const plain = createMarkdownProcessor();
    const hast = plain.runSync(plain.parse("see [[Note]]")) as unknown as HastNode;
    expect(collectLinks(hast)).toHaveLength(0);
  });
});
