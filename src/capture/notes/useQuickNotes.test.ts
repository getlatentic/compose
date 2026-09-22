// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeCaptureApi } from "../testing/fakeCaptureApi";
import { useQuickNotes, type QuickNotes } from "./useQuickNotes";

const OLD_DRAFT_KEY = "compose.captureDraft.v1";

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

async function loaded(api = fakeCaptureApi().api) {
  const hook = renderHook(() => useQuickNotes(api));
  await waitFor(() => expect(hook.result.current.loaded).toBe(true));
  return hook;
}

/** The editor holds `body` for note `id` and reports it only when flushed, as it does inside its pause. */
function typedNotReported(notes: QuickNotes, id: string, body: string) {
  let pending: string | null = body;
  notes.onEditorFlush(() => {
    if (pending === null) return;
    notes.edit(id, pending);
    pending = null;
  });
}

describe("quick notes", () => {
  it("start with one blank note to type into, kept only once typed in", async () => {
    const fake = fakeCaptureApi();
    const { result } = await loaded(fake.api);
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.active?.body).toBe("");

    act(() => result.current.edit(result.current.active!.id, "Groceries"));
    await act(() => result.current.flush());
    expect(fake.api.keepNote).toHaveBeenCalledWith(result.current.active!.id, "Groceries");
  });

  it("keep typing after a pause, not on every keystroke", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fake = fakeCaptureApi();
    const { result } = await loaded(fake.api);
    const id = result.current.active!.id;
    act(() => {
      result.current.edit(id, "G");
      result.current.edit(id, "Gr");
      result.current.edit(id, "Gro");
    });
    expect(fake.api.keepNote).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(fake.api.keepNote).toHaveBeenCalledTimes(1);
    expect(fake.api.keepNote).toHaveBeenCalledWith(id, "Gro");
  });

  it("bring the single draft of the old window in as a note", async () => {
    localStorage.setItem(OLD_DRAFT_KEY, "An idea from before");
    const fake = fakeCaptureApi();
    const { result } = await loaded(fake.api);
    expect(result.current.notes.map((note) => note.body)).toEqual(["An idea from before"]);
    expect(localStorage.getItem(OLD_DRAFT_KEY)).toBeNull();
  });

  it("hold several notes, newest first, and a new one reuses the blank one", async () => {
    const fake = fakeCaptureApi({
      notes: [
        { id: "a", body: "Older", createdAt: 1, updatedAt: 1 },
        { id: "b", body: "Newer", createdAt: 2, updatedAt: 2 },
      ],
    });
    const { result } = await loaded(fake.api);
    expect(result.current.notes.map((note) => note.body)).toEqual(["Newer", "Older"]);

    let first!: { id: string };
    act(() => {
      first = result.current.create();
    });
    act(() => {
      result.current.create();
    });
    expect(result.current.notes).toHaveLength(3);
    expect(result.current.active?.id).toBe(first.id);
  });

  it("take what was typed a moment ago before starting or moving to another note, so it is neither reused nor lost", async () => {
    const { result } = await loaded(fakeCaptureApi({ notes: [{ id: "a", body: "Groceries", createdAt: 1, updatedAt: 1 }] }).api);
    const bodyOf = (id: string) => result.current.notes.find((note) => note.id === id)?.body;
    let callAda!: { id: string };
    act(() => {
      callAda = result.current.create();
    });

    act(() => typedNotReported(result.current, callAda.id, "Call Ada"));
    let next!: { id: string };
    act(() => {
      next = result.current.create();
    });
    expect(next.id).not.toBe(callAda.id);
    expect(bodyOf(callAda.id)).toBe("Call Ada");

    act(() => typedNotReported(result.current, next.id, "Buy bread"));
    act(() => result.current.select("a"));
    expect(bodyOf(next.id)).toBe("Buy bread");
  });

  it("count what was typed a moment ago when asked whether a note has text", async () => {
    const { result } = await loaded();
    const id = result.current.active!.id;
    act(() => typedNotReported(result.current, id, "Half a thought"));
    let hasText = false;
    act(() => {
      hasText = result.current.hasText(id);
    });
    expect(hasText).toBe(true);
  });

  it("start a note with text, kept at once", async () => {
    const fake = fakeCaptureApi();
    const { result } = await loaded(fake.api);
    act(() => {
      result.current.create("From the clipboard");
    });
    await act(() => result.current.flush());
    expect(result.current.active?.body).toBe("From the clipboard");
    expect([...fake.notes.values()].map((note) => note.body)).toEqual(["From the clipboard"]);
    expect(result.current.notes).toHaveLength(1);
  });

  it("save the editor's latest text, then move to the next note", async () => {
    const fake = fakeCaptureApi({
      notes: [
        { id: "a", body: "First", createdAt: 2, updatedAt: 2 },
        { id: "b", body: "Second", createdAt: 1, updatedAt: 1 },
      ],
    });
    const { result } = await loaded(fake.api);
    await act(async () => {
      expect(await result.current.save("a", "First, finished")).toBe(true);
    });
    expect(fake.saved).toEqual([{ id: "a", text: "First, finished" }]);
    expect(result.current.notes.map((note) => note.id)).toEqual(["b"]);
    expect(result.current.active?.id).toBe("b");
  });

  it("do not save a blank note", async () => {
    const fake = fakeCaptureApi();
    const { result } = await loaded(fake.api);
    await act(async () => {
      expect(await result.current.save(result.current.active!.id)).toBe(false);
    });
    expect(fake.api.save).not.toHaveBeenCalled();
  });

  it("do not come back after being saved while their last words were still being kept", async () => {
    const fake = fakeCaptureApi();
    let finishKeeping!: () => void;
    vi.mocked(fake.api.keepNote).mockImplementationOnce(
      (id, body) => new Promise((resolve) => (finishKeeping = () => resolve({ id, body, createdAt: 1, updatedAt: 1 }))),
    );
    const { result } = await loaded(fake.api);
    const id = result.current.active!.id;
    let flushing!: Promise<void>;
    let saving!: Promise<unknown>;
    act(() => {
      result.current.edit(id, "Almost done");
      flushing = result.current.flush();
      saving = result.current.save(id, "Almost done");
    });
    await Promise.resolve();
    expect(fake.api.save).not.toHaveBeenCalled();
    await act(async () => {
      finishKeeping();
      await flushing;
      await saving;
    });
    expect(fake.api.save).toHaveBeenCalledWith(id, "Almost done");
  });

  it("delete a note, and leave a blank one when it was the last", async () => {
    const fake = fakeCaptureApi({ notes: [{ id: "a", body: "Only", createdAt: 1, updatedAt: 1 }] });
    const { result } = await loaded(fake.api);
    await act(() => result.current.remove("a"));
    expect(fake.api.deleteNote).toHaveBeenCalledWith("a");
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.active?.body).toBe("");
  });

  it("say what went wrong when the app cannot keep a note", async () => {
    const fake = fakeCaptureApi();
    vi.mocked(fake.api.keepNote).mockRejectedValueOnce(new Error("Disk full"));
    const { result } = await loaded(fake.api);
    act(() => result.current.edit(result.current.active!.id, "Text"));
    await act(() => result.current.flush());
    expect(result.current.error).toBe("Disk full");
  });
});
