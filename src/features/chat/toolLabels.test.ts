import { describe, expect, it } from "vitest";

import { fileOpVerb, toolActionLabel } from "./toolLabels";

describe("fileOpVerb", () => {
  // The flicker guard: while a write runs, the per-tool card cannot know whether
  // the file pre-existed, so its verb must be create-vs-edit *neutral*. The
  // applied-diff card (which compares against the pre-run baseline) owns the
  // final "Created"/"Edited" headline. A "Creating…" here is exactly what made
  // an overwrite flip "Created" → "Edited" before the diff landed.
  it("uses a neutral running verb for write (no create-vs-edit claim mid-run)", () => {
    expect(fileOpVerb("write", "running")).toBe("Writing");
    expect(fileOpVerb("edit", "running")).toBe("Writing");
  });

  it("settles to a non-contradictory past tense once done", () => {
    // An uncovered write (no applied diff to contradict it) reads "Wrote", not
    // a guessed "Created"; a covered write is deduped away before this shows.
    expect(fileOpVerb("write", "done")).toBe("Wrote");
    expect(fileOpVerb("edit", "done")).toBe("Edited");
  });

  it("gives a plain failure phrase on error", () => {
    expect(fileOpVerb("write", "error")).toBe("Couldn't write");
    expect(fileOpVerb("edit", "error")).toBe("Couldn't edit");
  });
});

describe("toolActionLabel", () => {
  it("labels a known tool with the file basename", () => {
    expect(toolActionLabel("read_file", '{"path":"/a/b/Notes.md"}')).toBe("Reading Notes.md");
  });

  it("matches a harness's bare tool name by keyword (Ollama emits `read`)", () => {
    expect(toolActionLabel("read", '{"path":"/a/b/Notes.md"}')).toBe("Reading Notes.md");
    expect(toolActionLabel("read")).toBe("Reading your notes");
  });

  it("falls back to the de-underscored name for a truly unknown tool", () => {
    expect(toolActionLabel("frobnicate_widget")).toBe("Using frobnicate widget");
  });
});
