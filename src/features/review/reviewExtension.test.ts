// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FileReview } from "./liveEdits";
import { reviewBridge } from "./reviewBridge";
import { currentEdits, reviewMargin, setReviewMode } from "./reviewExtension";

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

/** Hand the editor the review, and turn review mode on unless told not to. */
function show(review: FileReview, reviewing = true): void {
  reviewBridge.setInputs([review], []);
  vi.advanceTimersByTime(0);
  if (reviewing) setReviewMode(view, true);
}

function marks(selector: string): string[] {
  return [...view.contentDOM.querySelectorAll(selector)].map((element) => element.textContent ?? "");
}

describe("reviewMargin", () => {
  it("marks each edit's words apart, shows the words it took out, and leaves the note alone", () => {
    show(applied);
    expect(currentEdits(view)).toHaveLength(2);
    expect(marks(".cm-review-in")).toEqual(["Participants were chosen", "purposive sampling"]);
    expect(marks(".cm-review-out")).toEqual(["We recruited nurses", "convenience"]);
    expect(view.state.doc.toString()).toBe(NOTE);
  });

  it("ties each edit's marks together for the hover link with its card", () => {
    show(applied);
    const ids = [...view.contentDOM.querySelectorAll("[data-review-edit]")].map((element) => element.getAttribute("data-review-edit"));
    expect(new Set(ids).size).toBe(2);
    expect(ids.filter((id) => id === ids[0])).toHaveLength(2);
  });

  it("outside review mode marks only the agent's words, and keeps the note's width", () => {
    show(applied, false);
    expect(marks(".cm-review-quiet")).toEqual(["Participants were chosen", "purposive sampling"]);
    expect(view.contentDOM.querySelector(".cm-review-out, .cm-review-in")).toBeNull();
    expect(view.dom.classList.contains("cm-review-wide")).toBe(false);
  });

  it("narrows the note only in review mode, and leaves review mode once nothing is left", () => {
    show(applied);
    expect(view.dom.classList.contains("cm-review-wide")).toBe(true);
    setReviewMode(view, false);
    expect(view.dom.classList.contains("cm-review-wide")).toBe(false);
    setReviewMode(view, true);
    reviewBridge.setInputs([], []);
    vi.advanceTimersByTime(0);
    expect(view.dom.classList.contains("cm-review-wide")).toBe(false);
    reviewBridge.setInputs([applied], []);
    vi.advanceTimersByTime(0);
    expect(view.dom.classList.contains("cm-review-wide")).toBe(false);
  });

  it("keeps marking the other edit after one is undone", () => {
    show(applied);
    const [first] = currentEdits(view);
    view.dispatch({ changes: { from: first.from, to: first.to, insert: first.replacement } });
    reviewBridge.setInputs([{ ...applied, dropped: [first.key] }], []);
    vi.advanceTimersByTime(300);
    expect(currentEdits(view)).toHaveLength(1);
    expect(marks(".cm-review-in")).toEqual(["purposive sampling"]);
  });

  it("follows an edit as the writer types above it, and drops it once its paragraph is edited by hand", () => {
    show(applied);
    view.dispatch({ changes: { from: 0, insert: "New first line.\n" } });
    const [edit] = currentEdits(view);
    expect(view.state.doc.sliceString(edit.from, edit.to)).toBe("Participants were chosen");
    view.dispatch({ changes: { from: edit.from, insert: "All " } });
    vi.advanceTimersByTime(300);
    expect(currentEdits(view)).toHaveLength(0);
  });

  it("keeps a replacement's old words apart from the new, and draws a deletion's words without the space", () => {
    show(applied);
    expect(view.contentDOM.querySelector(".cm-review-out")?.classList.contains("cm-review-other--replaced")).toBe(true);

    const deletion: FileReview = { ...applied, id: "r2", original: "Intro.\n\nWe recruited many nurses.\n\nEnd.", proposed: "Intro.\n\nWe recruited nurses.\n\nEnd." };
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: deletion.proposed } });
    reviewBridge.setInputs([deletion], []);
    vi.advanceTimersByTime(300);
    expect(marks(".cm-review-out")).toEqual(["many"]);
  });

  it("clears the marks when the review goes away", () => {
    show(applied);
    reviewBridge.setInputs([], []);
    vi.advanceTimersByTime(0);
    expect(view.contentDOM.querySelector(".cm-review-in")).toBeNull();
  });
});
