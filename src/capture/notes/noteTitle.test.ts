import { describe, expect, it } from "vitest";

import { noteTitle } from "./noteTitle";

describe("a quick note's name in the list", () => {
  it("is its first line that says something, without the Markdown", () => {
    expect(noteTitle("\n\n## Book idea\n\nA memoir")).toBe("Book idea");
    expect(noteTitle("- [ ] Call **Ada**")).toBe("Call Ada");
    expect(noteTitle("> A quote to keep")).toBe("A quote to keep");
    expect(noteTitle("1. First step")).toBe("1. First step");
  });

  it("is empty for a note with nothing in it yet", () => {
    expect(noteTitle("")).toBe("");
    expect(noteTitle("#\n- ")).toBe("");
  });
});
