import { describe, expect, it } from "vitest";

import { countUnsavedBuffers } from "./unsavedBuffers";
import type { WorkspaceFileBuffer } from "../../app/workspaceModel";

function buffer(dirty: boolean): WorkspaceFileBuffer {
  return { conflict: false, content: "", dirty, lastModifiedMs: 0, pendingChanges: [] };
}

describe("countUnsavedBuffers", () => {
  it("is zero when no files are open", () => {
    expect(countUnsavedBuffers({ fileContents: {} })).toBe(0);
  });

  it("is zero when every open buffer is saved", () => {
    expect(
      countUnsavedBuffers({ fileContents: { "a.md": buffer(false), "b.md": buffer(false) } }),
    ).toBe(0);
  });

  it("counts only the dirty buffers", () => {
    expect(
      countUnsavedBuffers({
        fileContents: { "a.md": buffer(true), "b.md": buffer(false), "c.md": buffer(true) },
      }),
    ).toBe(2);
  });
});
