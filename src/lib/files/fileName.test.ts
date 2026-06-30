import { describe, expect, it } from "vitest";

import { renameRelativePath, splitFileName } from "./fileName";

describe("splitFileName", () => {
  it("splits the directory, base name, and extension", () => {
    expect(splitFileName("Notes/Plan.md")).toEqual({ dir: "Notes/", base: "Plan", ext: ".md" });
    expect(splitFileName("Plan.md")).toEqual({ dir: "", base: "Plan", ext: ".md" });
    expect(splitFileName("a/b/c.json")).toEqual({ dir: "a/b/", base: "c", ext: ".json" });
  });

  it("treats a file with no dot as all base name, no extension", () => {
    expect(splitFileName("Notes/README")).toEqual({ dir: "Notes/", base: "README", ext: "" });
  });

  it("treats a leading-dot dotfile as having no extension", () => {
    expect(splitFileName(".gitignore")).toEqual({ dir: "", base: ".gitignore", ext: "" });
  });
});

describe("renameRelativePath", () => {
  it("keeps the folder and the extension, replacing only the base name", () => {
    expect(renameRelativePath("Notes/Plan.md", "Roadmap")).toBe("Notes/Roadmap.md");
    expect(renameRelativePath("Plan.md", "Roadmap")).toBe("Roadmap.md");
    expect(renameRelativePath("Notes/data.json", "info")).toBe("Notes/info.json");
  });

  it("preserves a missing extension", () => {
    expect(renameRelativePath("Notes/README", "GUIDE")).toBe("Notes/GUIDE");
  });

  it("trims surrounding whitespace from the new base", () => {
    expect(renameRelativePath("Notes/Plan.md", "  Roadmap  ")).toBe("Notes/Roadmap.md");
  });
});
