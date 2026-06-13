import { describe, expect, it } from "vitest";

import {
  CHUNK_THRESHOLD_BYTES,
  DEFAULT_CHUNK_BYTES,
  chunkMarkdownAtParagraphs,
  shouldChunk,
} from "./markdownChunker";

describe("shouldChunk", () => {
  it("returns false for empty input", () => {
    expect(shouldChunk("")).toBe(false);
  });

  it("returns false below the threshold", () => {
    expect(shouldChunk("x".repeat(CHUNK_THRESHOLD_BYTES - 1))).toBe(false);
  });

  it("returns true at the threshold", () => {
    expect(shouldChunk("x".repeat(CHUNK_THRESHOLD_BYTES))).toBe(true);
  });

  it("respects a custom threshold", () => {
    expect(shouldChunk("hello world", 5)).toBe(true);
    expect(shouldChunk("hi", 5)).toBe(false);
  });
});

describe("chunkMarkdownAtParagraphs — basic shape", () => {
  it("returns [] for empty input", () => {
    expect(chunkMarkdownAtParagraphs("")).toEqual([]);
  });

  it("returns a single chunk when the input is below the target", () => {
    const text = "# Heading\n\nSome prose.\n";
    expect(chunkMarkdownAtParagraphs(text, 1000)).toEqual([text]);
  });

  it("concatenation reproduces the input byte-for-byte", () => {
    // Build a doc that comfortably crosses several chunk boundaries.
    const paragraph = "This is a paragraph with some prose, repeated to add bytes. ".repeat(20);
    const text = Array.from({ length: 30 }, (_, i) => `## Section ${i}\n\n${paragraph}\n`).join("\n");
    const chunks = chunkMarkdownAtParagraphs(text, 2000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
  });
});

describe("chunkMarkdownAtParagraphs — paragraph boundary discipline", () => {
  it("splits at blank lines, never mid-paragraph", () => {
    const text = [
      "# H1",
      "",
      "Para one with some prose to push us over the small target.",
      "",
      "Para two with more prose for the same reason.",
      "",
      "Para three.",
      "",
    ].join("\n");
    const chunks = chunkMarkdownAtParagraphs(text, 30);
    // Every chunk must end with a paragraph break (a `\n\n` or end of input).
    for (let i = 0; i < chunks.length - 1; i += 1) {
      expect(chunks[i].endsWith("\n")).toBe(true);
    }
    // No chunk should start mid-paragraph (every non-first chunk begins
    // either at a heading, a list item, a fence, or some other block-level
    // token — never at lowercase prose).
    for (let i = 1; i < chunks.length; i += 1) {
      const firstChar = chunks[i][0];
      expect(firstChar === undefined || /[#`\-*>0-9A-Z\s]/.test(firstChar)).toBe(true);
    }
  });

  it("never breaks inside a fenced code block (backticks)", () => {
    // A code block big enough that, without fence-awareness, the chunker
    // would try to split inside it.
    const code = ["```python", ...Array.from({ length: 200 }, (_, i) => `print(${i})`), "```"].join("\n");
    const text = `# Before\n\nSome prose.\n\n${code}\n\nAfter.\n`;
    const chunks = chunkMarkdownAtParagraphs(text, 200);
    // Each chunk should contain a balanced number of ``` fences.
    for (const chunk of chunks) {
      const fences = chunk.match(/^```/gm) ?? [];
      expect(fences.length % 2).toBe(0);
    }
  });

  it("never breaks inside a fenced code block (tildes)", () => {
    const code = ["~~~rust", ...Array.from({ length: 200 }, (_, i) => `let x${i} = ${i};`), "~~~"].join("\n");
    const text = `Intro.\n\n${code}\n\nOutro.\n`;
    const chunks = chunkMarkdownAtParagraphs(text, 200);
    for (const chunk of chunks) {
      const fences = chunk.match(/^~~~/gm) ?? [];
      expect(fences.length % 2).toBe(0);
    }
  });

  it("treats a blank line inside a code block as a non-flush point", () => {
    const code = ["```", "line one", "", "line two after blank", "", "line three", "```"].join("\n");
    const text = `Intro.\n\n${code}\n\nOutro.\n`;
    const chunks = chunkMarkdownAtParagraphs(text, 20);
    // The code block is small enough to stay in one chunk if we respect
    // the fence. (We can't assert exactly one chunk because Intro / Outro
    // may flush on either side; but no chunk can contain just part of
    // the fence body.)
    for (const chunk of chunks) {
      const openFences = chunk.match(/^```/gm) ?? [];
      expect(openFences.length % 2).toBe(0);
    }
  });
});

describe("chunkMarkdownAtParagraphs — pathological inputs", () => {
  it("returns a single chunk for a giant single paragraph (no blank lines)", () => {
    const text = "word ".repeat(100_000);
    const chunks = chunkMarkdownAtParagraphs(text, 1024);
    expect(chunks).toEqual([text]);
  });

  it("handles a document that's all blank lines", () => {
    const text = "\n".repeat(100);
    const chunks = chunkMarkdownAtParagraphs(text, 10);
    expect(chunks.join("")).toBe(text);
  });

  it("handles a document without a trailing newline", () => {
    const text = "# Heading\n\nProse without a trailing newline.";
    expect(chunkMarkdownAtParagraphs(text, 1000)).toEqual([text]);
  });

  it("works on realistic-shaped 1MB content", () => {
    // Production-readiness fixture-shaped content: heading + prose
    // paragraphs + bullet lists + code blocks + tables, repeated to
    // ~1MB. We're checking the chunker is fast and correct here, not
    // that the chunks are any specific size.
    const section = [
      "## Section",
      "",
      "Some paragraph prose that says things about the topic at hand.",
      "",
      "- bullet one",
      "- bullet two",
      "- bullet three",
      "",
      "> Block quote with a thought.",
      "",
      "```js",
      "function f(x) { return x + 1; }",
      "```",
      "",
    ].join("\n");
    const text = section.repeat(8000); // ~1.5MB
    expect(text.length).toBeGreaterThan(1024 * 1024);

    const chunks = chunkMarkdownAtParagraphs(text, DEFAULT_CHUNK_BYTES);

    // Concat is exact.
    expect(chunks.join("")).toBe(text);
    // We got plenty of chunks.
    expect(chunks.length).toBeGreaterThan(10);
    // Each fence pair is intact in its chunk.
    for (const chunk of chunks) {
      const fences = chunk.match(/^```/gm) ?? [];
      expect(fences.length % 2).toBe(0);
    }
  });
});
