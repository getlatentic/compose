import { describe, expect, it } from "vitest";

import { changeBlocks } from "./changeBlocks";
import { allLiveBlocks, liveBlocks, reviewBlockKeys, type FileReview, type LiveBlock } from "./liveBlocks";
import { wordDiff } from "./wordDiff";

const ORIGINAL = ["# Method", "", "We recruited nurses.", "", "Interviews ran long.", "", "Ethics approved.", "", "Thanks."].join("\n");
const PROPOSED = ["# Method", "", "Participants were chosen by sampling.", "", "Interviews ran long.", "", "Ethics approved (2019).", "", "Thanks.", "", "A new closing line."].join("\n");

function review(mode: FileReview["mode"], decided: string[] = []): FileReview {
  return { id: "r1", mode, agentName: "Claude", original: ORIGINAL, proposed: PROPOSED, decided };
}

function apply(note: string, block: LiveBlock): string {
  return note.slice(0, block.from) + block.replacement + note.slice(block.to);
}

/** Apply blocks last-first, so earlier positions stay valid. */
function applyAll(note: string, blocks: LiveBlock[]): string {
  return [...blocks].sort((a, b) => b.from - a.from).reduce(apply, note);
}

describe("changeBlocks", () => {
  it("groups each run of changed lines, with their line numbers on both sides", () => {
    const blocks = changeBlocks(ORIGINAL, PROPOSED);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatchObject({ removed: ["We recruited nurses."], added: ["Participants were chosen by sampling."], beforeLine: 2, afterLine: 2 });
    expect(blocks[2]).toMatchObject({ removed: [], added: ["", "A new closing line."], beforeLine: 9 });
  });
});

describe("liveBlocks, applied run", () => {
  it("finds every block in the note the agent wrote, and undoing them all gives back the original", () => {
    const blocks = liveBlocks(review("applied"), PROPOSED);
    expect(blocks).toHaveLength(3);
    expect(PROPOSED.slice(blocks[0].from, blocks[0].to)).toBe("Participants were chosen by sampling.");
    expect(applyAll(PROPOSED, blocks)).toBe(ORIGINAL);
  });

  it("undoes one block and leaves the others where they are", () => {
    const [first] = liveBlocks(review("applied"), PROPOSED);
    const note = apply(PROPOSED, first);
    expect(note).toContain("We recruited nurses.");
    expect(note).toContain("A new closing line.");
    expect(liveBlocks(review("applied"), note)).toHaveLength(2);
  });

  it("ignores the writer's own later edits and follows the blocks as text moves", () => {
    const edited = `Intro the writer added.\n\n${PROPOSED.replace("Interviews ran long.", "Interviews ran for an hour.")}`;
    const blocks = liveBlocks(review("applied"), edited);
    expect(blocks.map((b) => b.added)).toEqual(["Participants were chosen by sampling.", "Ethics approved (2019).", "\nA new closing line."]);
    expect(edited.slice(blocks[0].from, blocks[0].to)).toBe("Participants were chosen by sampling.");
  });

  it("drops a block the writer has rewritten by hand rather than offer a stale swap", () => {
    const edited = PROPOSED.replace("Participants were chosen by sampling.", "Participants were chosen on purpose.");
    expect(liveBlocks(review("applied"), edited)).toHaveLength(2);
  });

  it("hides a decided block", () => {
    const [firstKey] = reviewBlockKeys(review("applied"));
    expect(liveBlocks(review("applied", [firstKey]), PROPOSED)).toHaveLength(2);
  });
});

describe("liveBlocks, pending run", () => {
  it("finds the old text in the note, and accepting every block gives the proposal", () => {
    const blocks = liveBlocks(review("pending"), ORIGINAL);
    expect(blocks).toHaveLength(3);
    expect(ORIGINAL.slice(blocks[0].from, blocks[0].to)).toBe("We recruited nurses.");
    expect(applyAll(ORIGINAL, blocks)).toBe(PROPOSED);
  });

  it("round-trips insertions and deletions at the start and end of a note, with and without a final newline", () => {
    for (const [original, proposed] of [
      ["b\nc", "a\nb\nc"],
      ["a\nb\nc", "b\nc"],
      ["a\nb", "a"],
      ["a\nb\n", "a\n"],
      ["a\n", "a\nb\n"],
      ["", "only line"],
    ]) {
      const pending: FileReview = { id: "r", mode: "pending", agentName: "A", original, proposed, decided: [] };
      expect(applyAll(original, liveBlocks(pending, original)), JSON.stringify([original, proposed])).toBe(proposed);
      const applied: FileReview = { ...pending, mode: "applied" };
      expect(applyAll(proposed, liveBlocks(applied, proposed)), JSON.stringify([proposed, original])).toBe(original);
    }
  });
});

describe("allLiveBlocks", () => {
  it("returns blocks of every review in document order", () => {
    const later: FileReview = { ...review("applied"), id: "r2" };
    const blocks = allLiveBlocks([review("applied"), later], PROPOSED);
    expect(blocks.map((b) => b.from)).toEqual([...blocks.map((b) => b.from)].sort((a, b) => a - b));
  });
});

describe("wordDiff", () => {
  it("keeps the shared words and marks the swapped ones", () => {
    expect(wordDiff("We recruited them through convenience.", "Participants were chosen through purposive sampling.")).toEqual([
      { kind: "removed", text: "We recruited them" },
      { kind: "added", text: "Participants were chosen" },
      { kind: "same", text: " through " },
      { kind: "removed", text: "convenience" },
      { kind: "added", text: "purposive sampling" },
      { kind: "same", text: "." },
    ]);
  });
});
