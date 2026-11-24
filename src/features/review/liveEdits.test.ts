import { describe, expect, it } from "vitest";

import { agentBlocks, agentEditKeys } from "./agentEdits";
import { changeBlocks } from "./changeBlocks";
import { allLiveEdits, liveEdits, type FileReview, type LiveEdit } from "./liveEdits";
import { wordDiff } from "./wordDiff";

const ORIGINAL = ["# Method", "", "We recruited nurses.", "", "Interviews ran long.", "", "Ethics approved.", "", "Thanks."].join("\n");
const PROPOSED = ["# Method", "", "Participants were chosen by sampling.", "", "Interviews ran long.", "", "Ethics approved (2019).", "", "Thanks.", "", "A new closing line."].join("\n");

const BEFORE = "This study used a qualitative design to examine how ward nurses decide about escalating care.";
const AFTER = "This qualitative study examined how ward nurses decide whether to escalate care.";

function review(mode: FileReview["mode"], kept: string[] = [], dropped: string[] = [], original = ORIGINAL, proposed = PROPOSED): FileReview {
  return { id: "r1", mode, agentName: "Claude", original, proposed, kept, dropped };
}

function apply(note: string, edit: LiveEdit): string {
  return note.slice(0, edit.from) + edit.replacement + note.slice(edit.to);
}

/** Apply edits last-first, so earlier positions stay valid. */
function applyAll(note: string, edits: LiveEdit[]): string {
  return [...edits].sort((a, b) => b.from - a.from).reduce(apply, note);
}

describe("agentBlocks", () => {
  it("splits a rewritten sentence into one edit per run of changed words", () => {
    const [block] = agentBlocks(BEFORE, AFTER);
    expect(block.edits.map((edit) => [edit.removed.trim(), edit.added.trim()])).toEqual([
      ["study used a", ""],
      ["design to examine", "study examined"],
      ["about escalating", "whether to escalate"],
    ]);
    expect(block.edits[2].before).toBe(" how ward nurses decide ");
  });

  it("keeps lines that were added, removed or split as one edit for the whole run", () => {
    const blocks = agentBlocks(ORIGINAL, PROPOSED);
    expect(blocks[2].edits).toHaveLength(1);
    expect(blocks[2].edits[0]).toMatchObject({ removed: "", added: "\nA new closing line." });
  });

  it("gives each edit a key that is stable for the same change", () => {
    expect(agentEditKeys(BEFORE, AFTER)).toEqual(agentEditKeys(BEFORE, AFTER));
    expect(new Set(agentEditKeys(BEFORE, AFTER)).size).toBe(3);
  });
});

describe("liveEdits, applied run", () => {
  it("finds every edit in the note the agent wrote, and undoing them all gives back the original", () => {
    const edits = liveEdits(review("applied"), PROPOSED);
    expect(edits.map((edit) => PROPOSED.slice(edit.from, edit.to))).toEqual([
      "Participants were chosen by sampling",
      " (2019)",
      "\n\nA new closing line.",
    ]);
    expect(applyAll(PROPOSED, edits)).toBe(ORIGINAL);
  });

  it("undoes one word edit of a paragraph and keeps offering the others in it", () => {
    const r = review("applied", [], [], BEFORE, AFTER);
    const edits = liveEdits(r, AFTER);
    expect(edits).toHaveLength(3);
    const third = edits[2];
    const note = apply(AFTER, third);
    expect(note).toBe("This qualitative study examined how ward nurses decide about escalating care.");

    const left = liveEdits({ ...r, dropped: [third.key] }, note);
    expect(left.map((edit) => note.slice(edit.from, edit.to).trim())).toEqual(["", "study examined"]);
    expect(applyAll(note, left)).toBe(BEFORE);
  });

  it("keeps offering the rest after some are kept", () => {
    const r = review("applied", [], [], BEFORE, AFTER);
    const [first] = liveEdits(r, AFTER);
    expect(liveEdits({ ...r, kept: [first.key] }, AFTER)).toHaveLength(2);
  });

  it("ignores the writer's own later edits and follows the edits as text moves", () => {
    const edited = `Intro the writer added.\n\n${PROPOSED.replace("Interviews ran long.", "Interviews ran for an hour.")}`;
    const edits = liveEdits(review("applied"), edited);
    expect(edits.map((edit) => edited.slice(edit.from, edit.to))).toEqual([
      "Participants were chosen by sampling",
      " (2019)",
      "\n\nA new closing line.",
    ]);
  });

  it("drops edits in a paragraph the writer has rewritten by hand rather than offer a stale swap", () => {
    const edited = PROPOSED.replace("Participants were chosen by sampling.", "Participants were chosen on purpose.");
    expect(liveEdits(review("applied"), edited)).toHaveLength(2);
  });
});

describe("liveEdits, pending run", () => {
  it("finds the old words in the note, and accepting every edit gives the proposal", () => {
    const edits = liveEdits(review("pending"), ORIGINAL);
    expect(edits).toHaveLength(3);
    expect(ORIGINAL.slice(edits[0].from, edits[0].to)).toBe("We recruited nurses");
    expect(applyAll(ORIGINAL, edits)).toBe(PROPOSED);
  });

  it("accepts one word edit and keeps offering the others", () => {
    const r = review("pending", [], [], BEFORE, AFTER);
    const edits = liveEdits(r, BEFORE);
    const note = apply(BEFORE, edits[1]);
    const left = liveEdits({ ...r, kept: [edits[1].key] }, note);
    expect(left).toHaveLength(2);
    expect(applyAll(note, left)).toBe(AFTER);
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
      const pending = review("pending", [], [], original, proposed);
      expect(applyAll(original, liveEdits(pending, original)), JSON.stringify([original, proposed])).toBe(proposed);
      const applied = review("applied", [], [], original, proposed);
      expect(applyAll(proposed, liveEdits(applied, proposed)), JSON.stringify([proposed, original])).toBe(original);
    }
  });
});

describe("allLiveEdits", () => {
  it("returns edits of every review in document order", () => {
    const later: FileReview = { ...review("applied"), id: "r2" };
    const edits = allLiveEdits([review("applied"), later], PROPOSED);
    expect(edits.map((e) => e.from)).toEqual([...edits.map((e) => e.from)].sort((a, b) => a - b));
  });
});

describe("changeBlocks and wordDiff", () => {
  it("groups each run of changed lines, with their line numbers on both sides", () => {
    const blocks = changeBlocks(ORIGINAL, PROPOSED);
    expect(blocks).toHaveLength(3);
    expect(blocks[2]).toMatchObject({ removed: [], added: ["", "A new closing line."], beforeLine: 9 });
  });

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

describe("a note rewritten past the diff's size cap", () => {
  const lines = (prefix: string) => Array.from({ length: 2100 }, (_, index) => `${prefix} ${index}`);
  const original = lines("line").join("\n");
  const proposed = lines("line").map((line, index) => (index === 5 ? "line five, reworded" : line)).join("\n");

  it("places the edit while the note still lines up with the proposal", () => {
    expect(liveEdits(review("pending", [], [], original, proposed), original)).toHaveLength(1);
  });

  it("places no edits once nothing lines up, so the change is reviewed on its chat card", () => {
    expect(liveEdits(review("pending", [], [], original, proposed), lines("unrelated").join("\n"))).toEqual([]);
  });
});
