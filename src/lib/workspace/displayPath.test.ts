import { describe, expect, it } from "vitest";

import { basename, tildePath } from "./displayPath";

describe("tildePath", () => {
  it("collapses a macOS home prefix to ~", () => {
    expect(tildePath("/Users/dev/Documents/notes")).toBe("~/Documents/notes");
  });

  it("collapses a Linux home prefix to ~", () => {
    expect(tildePath("/home/dev/workspace")).toBe("~/workspace");
  });

  it("maps the home directory itself to ~", () => {
    expect(tildePath("/Users/dev")).toBe("~");
  });

  it("leaves a non-home absolute path unchanged", () => {
    expect(tildePath("/opt/data/vault")).toBe("/opt/data/vault");
  });
});

describe("basename", () => {
  it("returns the last segment of a nested path", () => {
    expect(basename("Others/Writing/data-science-nigeria-video.md")).toBe(
      "data-science-nigeria-video.md",
    );
  });

  it("returns a bare name unchanged", () => {
    expect(basename("note.md")).toBe("note.md");
  });

  it("ignores a trailing slash so a folder yields its own name", () => {
    expect(basename("Others/Writing/")).toBe("Writing");
  });
});
