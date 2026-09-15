import { describe, expect, it } from "vitest";

import { noteFromSelection } from "./useServiceNewNote";

describe("noteFromSelection", () => {
  it("gives prose the same untitled heading as a new note", () => {
    expect(noteFromSelection("Attention is all you need.")).toBe(
      "# Untitled\n\nAttention is all you need.\n",
    );
  });

  it("keeps a heading the selection already carries", () => {
    expect(noteFromSelection("## Method\n\nWe sample 30 runs.")).toBe(
      "## Method\n\nWe sample 30 runs.\n",
    );
  });

  it("does not mistake a fenced comment or a bare hash for a heading", () => {
    expect(noteFromSelection("#tag on its own")).toBe("# Untitled\n\n#tag on its own\n");
    expect(noteFromSelection("####### seven hashes")).toBe(
      "# Untitled\n\n####### seven hashes\n",
    );
  });

  it("ends with exactly one newline whatever the selection's trailing space", () => {
    expect(noteFromSelection("Body text\n\n\n  ")).toBe("# Untitled\n\nBody text\n");
  });
});
