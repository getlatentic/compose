import { describe, expect, it } from "vitest";
import { locateInMarkdown } from "./TiptapMarkdownEditor";

describe("locateInMarkdown", () => {
  it("finds the first occurrence when the prefix hint matches", () => {
    const md = "Hello world. This is a test.";
    expect(locateInMarkdown(md, "world", 6)).toEqual({ start: 6, end: 11 });
  });

  it("walks forward from the hint to disambiguate duplicates", () => {
    // Two occurrences of "the cat". Prefix lands past the first.
    const md = "the cat slept. the cat woke.";
    // Selection is the second "the cat" — prefix is "the cat slept. " (15 chars).
    const range = locateInMarkdown(md, "the cat", 15);
    expect(range).toEqual({ start: 15, end: 22 });
  });

  it("falls back to whole-document search when forward search misses", () => {
    // Rendered text drops collapsed whitespace, so the prefix
    // overshoots the markdown position.
    const md = "leading\n\n\n\ntarget word";
    const range = locateInMarkdown(md, "target", 100);
    expect(range.start).toBe(md.indexOf("target"));
  });

  it("returns a zero-width range when the text contains markers the renderer dropped", () => {
    const md = "Use **bold** carefully.";
    // The user "selected" `**bold**` from the rendered view; the
    // rendered selection IS "bold" (markers hidden), but if some
    // upstream change started passing the raw form, we should
    // still cope.
    const range = locateInMarkdown(md, "rendered-bold", 0);
    expect(range.start).toBe(range.end);
  });

  it("handles empty selection text gracefully", () => {
    expect(locateInMarkdown("hello", "", 3)).toEqual({ start: 3, end: 3 });
    expect(locateInMarkdown("hello", "", 100)).toEqual({ start: 5, end: 5 });
  });

  it("works when the hint is exactly at the text", () => {
    const md = "preface bold middle";
    expect(locateInMarkdown(md, "bold", 8)).toEqual({ start: 8, end: 12 });
  });
});
