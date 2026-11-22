// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileReview } from "./liveBlocks";
import { reviewBridge } from "./reviewBridge";
import { currentBlocks, reviewMargin } from "./reviewExtension";

const ORIGINAL = "Intro.\n\nWe recruited nurses.\n\nEnd.";
const NOTE = "Intro.\n\nParticipants were chosen.\n\nEnd.";

const applied: FileReview = { id: "r1", mode: "applied", agentName: "Claude", original: ORIGINAL, proposed: NOTE, decided: [] };

let view: EditorView;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", () => 0);
  view = new EditorView({
    state: EditorState.create({ doc: NOTE, extensions: reviewMargin.extensions ?? [] }),
    parent: document.body,
  });
});

afterEach(() => {
  view.destroy();
  reviewBridge.setInputs([], []);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reviewMargin", () => {
  it("marks the words a change put in and shows the words it took out, without changing the note", () => {
    reviewBridge.setInputs([applied], []);
    vi.advanceTimersByTime(0);
    expect(currentBlocks(view)).toHaveLength(1);
    expect(view.contentDOM.querySelector(".cm-review-in")?.textContent).toBe("Participants were chosen");
    expect(view.contentDOM.querySelector(".cm-review-out")?.textContent).toBe("We recruited nurses");
    expect(view.state.doc.toString()).toBe(NOTE);
  });

  it("follows a block as the writer types above it, and drops it once edited by hand", () => {
    reviewBridge.setInputs([applied], []);
    vi.advanceTimersByTime(0);
    view.dispatch({ changes: { from: 0, insert: "New first line.\n" } });
    const [block] = currentBlocks(view);
    expect(view.state.doc.sliceString(block.from, block.to)).toBe("Participants were chosen.");
    view.dispatch({ changes: { from: block.from, insert: "All " } });
    vi.advanceTimersByTime(300);
    expect(currentBlocks(view)).toHaveLength(0);
  });

  it("keeps a replacement's old words apart from the new ones, and leaves a plain deletion alone", () => {
    reviewBridge.setInputs([applied], []);
    vi.advanceTimersByTime(0);
    expect(view.contentDOM.querySelector(".cm-review-out")?.classList.contains("cm-review-other--replaced")).toBe(true);

    const deletion: FileReview = { ...applied, id: "r2", original: "Intro.\n\nWe recruited many nurses.\n\nEnd.", proposed: "Intro.\n\nWe recruited nurses.\n\nEnd." };
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: deletion.proposed } });
    reviewBridge.setInputs([deletion], []);
    vi.advanceTimersByTime(300);
    const out = view.contentDOM.querySelector(".cm-review-out");
    expect(out?.textContent?.trim()).toBe("many");
    expect(out?.classList.contains("cm-review-other--replaced")).toBe(false);
  });

  it("clears the marks when the review goes away", () => {
    reviewBridge.setInputs([applied], []);
    vi.advanceTimersByTime(0);
    reviewBridge.setInputs([], []);
    vi.advanceTimersByTime(0);
    expect(view.contentDOM.querySelector(".cm-review-in")).toBeNull();
  });
});
