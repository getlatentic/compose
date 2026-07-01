import { describe, expect, it } from "vitest";
import { buildTree, flatten } from "./FileTree";
import type { WorkspaceFileEntry } from "./fileTreeTypes";

function file(relativePath: string): WorkspaceFileEntry {
  return { relativePath, lastModifiedMs: 0, sizeBytes: 0 };
}

// Talks/ (a.md, sub/b.md) and a root note — a two-level tree to open into.
const tree = buildTree([file("Talks/a.md"), file("Talks/sub/b.md"), file("root.md")], []);
const paths = (expanded: Set<string>) => flatten(tree, expanded).map((node) => node.path);

describe("flatten (#52)", () => {
  it("shows only top-level rows when nothing is expanded — the collapsed default", () => {
    expect(paths(new Set())).toEqual(["Talks", "root.md"]);
  });

  it("reveals a folder's immediate children but not deeper ones", () => {
    // Opening Talks shows its children (folders before files) but not sub's.
    expect(paths(new Set(["Talks"]))).toEqual(["Talks", "Talks/sub", "Talks/a.md", "root.md"]);
  });

  it("reveals a nested file only when its whole ancestor chain is expanded", () => {
    expect(paths(new Set(["Talks", "Talks/sub"]))).toContain("Talks/sub/b.md");
    // The chain must be complete — expanding only the leaf folder is not enough.
    expect(paths(new Set(["Talks/sub"]))).not.toContain("Talks/sub/b.md");
  });
});
