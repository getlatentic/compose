import { describe, expect, it } from "vitest";
import type { Workspace } from "../workspaceModel";
import { errorMessage, nextUntitledPath } from "./internals";

// nextUntitledPath only reads `files` (their relative paths) + `openFilePaths`,
// so a minimal stand-in exercises the real collision logic without a full
// workspace object.
function ws(relativePaths: string[], openFilePaths: string[] = []): Workspace {
  return {
    files: relativePaths.map((relativePath) => ({ relativePath })),
    openFilePaths,
  } as unknown as Workspace;
}

describe("nextUntitledPath", () => {
  it("defaults to untitled-1.md at the root", () => {
    expect(nextUntitledPath(ws([]))).toBe("untitled-1.md");
  });

  it("skips existing untitled notes at the root", () => {
    expect(nextUntitledPath(ws(["untitled-1.md", "untitled-2.md"]))).toBe("untitled-3.md");
  });

  it("avoids collisions with open (unsaved) tabs too", () => {
    expect(nextUntitledPath(ws([], ["untitled-1.md"]))).toBe("untitled-2.md");
  });

  it("creates inside a folder when given a dir", () => {
    expect(nextUntitledPath(ws([]), "Projects")).toBe("Projects/untitled-1.md");
  });

  it("numbers per-folder — a root untitled doesn't bump the folder's count", () => {
    expect(nextUntitledPath(ws(["untitled-1.md"]), "Projects")).toBe("Projects/untitled-1.md");
    expect(nextUntitledPath(ws(["Projects/untitled-1.md"]), "Projects")).toBe(
      "Projects/untitled-2.md",
    );
  });

  it("normalizes a trailing slash on the dir", () => {
    expect(nextUntitledPath(ws([]), "Projects/")).toBe("Projects/untitled-1.md");
  });
});

describe("errorMessage", () => {
  it("surfaces a plain string, which is how Tauri rejects", () => {
    // The case that matters. `invoke` rejects with a String, not an Error, so
    // the common `err instanceof Error ? err.message : fallback` throws away
    // whatever the backend said. That is how "Could not unlock the credential
    // store. Reset it in Settings." reached a user as "Could not save the
    // OpenRouter API key" — a sentence with no next step in it.
    expect(errorMessage("Could not unlock the credential store.", "fallback")).toBe(
      "Could not unlock the credential store.",
    );
  });

  it("uses an Error's message", () => {
    expect(errorMessage(new Error("disk is full"), "fallback")).toBe("disk is full");
  });

  it("falls back when there is nothing to say", () => {
    expect(errorMessage(new Error("   "), "fallback")).toBe("fallback");
    expect(errorMessage("   ", "fallback")).toBe("fallback");
    expect(errorMessage(undefined, "fallback")).toBe("fallback");
    expect(errorMessage({ code: 500 }, "fallback")).toBe("fallback");
  });
});
