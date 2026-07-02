import { describe, expect, it } from "vitest";
import { buildTree } from "./FileTree";
import type { WorkspaceFileEntry } from "./fileTreeTypes";

function file(relativePath: string): WorkspaceFileEntry {
  return { relativePath, lastModifiedMs: 0, sizeBytes: 0 };
}

describe("buildTree", () => {
  it("renders an empty folder that holds no file (#49)", () => {
    const tree = buildTree([], ["Talks"]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ type: "folder", name: "Talks", path: "Talks" });
  });

  it("keeps a folder present even when no file sits under it", () => {
    // The folder is still in `folders` (it exists on disk) after losing its
    // last file, so it must remain — this is the no-auto-vanish guarantee.
    const tree = buildTree([], ["Projects"]);
    expect(tree.map((node) => node.name)).toContain("Projects");
  });

  it("merges explicit folders with folders derived from file paths", () => {
    const tree = buildTree([file("Projects/a.md")], ["Projects", "Talks"]);
    expect(tree.map((node) => node.name).sort()).toEqual(["Projects", "Talks"]);
    const projects = tree.find((node) => node.name === "Projects");
    expect(projects?.type).toBe("folder");
    if (projects?.type === "folder") {
      expect(projects.children.map((child) => child.name)).toEqual(["a.md"]);
    }
  });

  it("nests files under their folder and sorts folders before files", () => {
    const tree = buildTree([file("z.md"), file("A/b.md")], []);
    expect(tree.map((node) => `${node.type}:${node.name}`)).toEqual(["folder:A", "file:z.md"]);
  });
});
