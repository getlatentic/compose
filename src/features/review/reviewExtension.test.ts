// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileReview } from "./liveEdits";
import { reviewBridge } from "./reviewBridge";
import { currentEdits, reviewMargin } from "./reviewExtension";

const ORIGINAL = "Intro.\n\nWe recruited nurses through convenience.\n\nEnd.";
const NOTE = "Intro.\n\nParticipants were chosen through purposive sampling.\n\nEnd.";

const applied: FileReview = { id: "r1", mode: "applied", agentName: "Claude", original: ORIGINAL, proposed: NOTE, kept: [], dropped: [] };

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

function marks(selector: string): string[] {
  return [...view.contentDOM.querySelectorAll(selector)].map((element) => element.textContent ?? "");
}

describe("reviewMargin", () => {
  it("marks each edit's words apart, shows the words it took out, and leaves the note alone", () => {
    reviewBridge.setInputs([applied], []);
    vi.advanceTimersByTime(0);
    expect(currentEdits(view)).toHaveLength(2);
    expect(marks(".cm-review-in")).toEqual(["Participants were chosen", "purposive sampling"]);
    expect(marks(".cm-review-out")).toEqual(["We recruited nurses", "convenience"]);
    expect(view.state.doc.toString()).toBe(NOTE);
  });

  it("ties each edit's marks together for the hover link with its card", () => {
    reviewBridge.setInputs([applied], []);
    vi.advanceTimersByTime(0);
    const ids = [...view.contentDOM.querySelectorAll("[data-review-edit]")].map((element) => element.getAttribute("data-review-edit"));
    expect(new Set(ids).size).toBe(2);
    expect(ids.filter((id) => id === ids[0])).toHaveLength(2);
  });

  it("narrows the note for the margin only while there is something in it", () => {
    expect(view.dom.classList.contains("cm-review-wide")).toBe(false);
    reviewBridge.setInputs([applied], []);
    vi.advanceTimersByTime(0);
    expect(view.dom.classList.contains("cm-review-wide")).toBe(true);
    reviewBridge.setInputs([], []);
    vi.advanceTimersByTime(0);
    expect(view.dom.classList.contains("cm-review-wide")).toBe(false);
  });

  it("keeps marking the other edit after one is undone", () => {
    reviewBridge.setInputs([applied], []);
    vi.advanceTimersByTime(0);
    const [first] = currentEdits(view);
    view.dispatch({ changes: { from: first.from, to: first.to, insert: first.replacement } });
    reviewBridge.setInputs([{ ...applied, dropped: [first.key] }], []);
    vi.advanceTimersByTime(300);
    expect(currentEdits(view)).toHaveLength(1);
    expect(marks(".cm-review-in")).toEqual(["purposive sampling"]);
  });

  it("follows an edit as the writer types above it, and drops it once its paragraph is edited by hand", () => {
    reviewBridge.setInputs([applied], []);
    vi.advanceTimersByTime(0);
    view.dispatch({ changes: { from: 0, insert: "New first line.\n" } });
    const [edit] = currentEdits(view);
    expect(view.state.doc.sliceString(edit.from, edit.to)).toBe("Participants were chosen");
    view.dispatch({ changes: { from: edit.from, insert: "All " } });
    vi.advanceTimersByTime(300);
    expect(currentEdits(view)).toHaveLength(0);
  });

  it("keeps a replacement's old words apart from the new, and draws a deletion's words without the space", () => {
    reviewBridge.setInputs([applied], []);
    vi.advanceTimersByTime(0);
    expect(view.contentDOM.querySelector(".cm-review-out")?.classList.contains("cm-review-other--replaced")).toBe(true);

    const deletion: FileReview = { ...applied, id: "r2", original: "Intro.\n\nWe recruited many nurses.\n\nEnd.", proposed: "Intro.\n\nWe recruited nurses.\n\nEnd." };
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: deletion.proposed } });
    reviewBridge.setInputs([deletion], []);
    vi.advanceTimersByTime(300);
    expect(marks(".cm-review-out")).toEqual(["many"]);
  });

  it("clears the marks when the review goes away", () => {
    reviewBridge.setInputs([applied], []);
    vi.advanceTimersByTime(0);
    reviewBridge.setInputs([], []);
    vi.advanceTimersByTime(0);
    expect(view.contentDOM.querySelector(".cm-review-in")).toBeNull();
  });
});
