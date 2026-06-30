import { describe, expect, it } from "vitest";

import { ancestorFolders } from "./FileTree";

describe("ancestorFolders", () => {
  it("lists the folders leading to a file, outermost first", () => {
    expect(ancestorFolders("Applications/Fellowships/Afrika Kommt.md")).toEqual([
      "Applications",
      "Applications/Fellowships",
    ]);
  });

  it("returns an empty list for a root-level file (no folders to expand)", () => {
    expect(ancestorFolders("Plan.md")).toEqual([]);
  });

  it("handles a single containing folder", () => {
    expect(ancestorFolders("Notes/Plan.md")).toEqual(["Notes"]);
  });
});
