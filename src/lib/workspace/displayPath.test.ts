import { describe, expect, it } from "vitest";

import { tildePath } from "./displayPath";

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
