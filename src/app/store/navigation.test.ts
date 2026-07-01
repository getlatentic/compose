import { describe, expect, it } from "vitest";
import { pruneNavHistory } from "./navigation";
import type { NavEntry } from "./types";

const file = (id: string): NavEntry => ({ kind: "file", id, workspaceId: "w1" });

describe("pruneNavHistory (#45)", () => {
  it("removes matching entries and keeps the cursor on the same surviving entry", () => {
    const result = pruneNavHistory(
      { navHistory: [file("a"), file("b"), file("c")], navIndex: 2 },
      (entry) => entry.id !== "b",
    );
    expect(result.navHistory.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(result.navIndex).toBe(1); // still at "c"
  });

  it("moves the cursor to the previous entry when the current one is removed", () => {
    const result = pruneNavHistory(
      { navHistory: [file("a"), file("b"), file("c")], navIndex: 1 },
      (entry) => entry.id !== "b",
    );
    expect(result.navHistory.map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(result.navIndex).toBe(0); // "b" was current → land on "a"
  });

  it("empties to navIndex -1 when everything is removed", () => {
    const result = pruneNavHistory({ navHistory: [file("a")], navIndex: 0 }, () => false);
    expect(result.navHistory).toEqual([]);
    expect(result.navIndex).toBe(-1);
  });
});
