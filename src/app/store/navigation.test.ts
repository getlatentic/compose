import { describe, expect, it } from "vitest";
import { NAV_HISTORY_LIMIT, pruneNavHistory, pushNavEntry } from "./navigation";
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

describe("nav history cap", () => {
  it("drops the oldest entries past NAV_HISTORY_LIMIT instead of growing forever", () => {
    let state = { navHistory: [] as NavEntry[], navIndex: -1 };
    for (let index = 0; index < NAV_HISTORY_LIMIT + 25; index += 1) {
      const next = pushNavEntry(state, {
        kind: "file",
        id: `note-${index}.md`,
        workspaceId: "w",
      });
      if (next) {
        state = next;
      }
    }
    expect(state.navHistory.length).toBe(NAV_HISTORY_LIMIT);
    expect(state.navIndex).toBe(NAV_HISTORY_LIMIT - 1);
    // The survivors are the NEWEST entries; the head rolled off.
    expect(state.navHistory[0].id).toBe("note-25.md");
    expect(state.navHistory[NAV_HISTORY_LIMIT - 1].id).toBe(`note-${NAV_HISTORY_LIMIT + 24}.md`);
  });
});
