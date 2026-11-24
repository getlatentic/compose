import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileConflictError } from "../../lib/workspace/fileErrors";
import { autosaveDelayMs, createPagedSaver, type SaveState } from "./pagedSaver";

function saver(save: (overChanges: boolean) => Promise<void> = async () => {}) {
  const states: SaveState["status"][] = [];
  const saves: boolean[] = [];
  const made = createPagedSaver({
    sent: async () => {},
    save: (overChanges) => {
      saves.push(overChanges);
      return save(overChanges);
    },
    delayMs: 1_000,
    onState: (state) => states.push(state.status),
  });
  return { made, states, saves };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the saving of a large file", () => {
  it("writes the file once, a while after the last of a run of edits", async () => {
    const { made, states, saves } = saver();
    made.edited();
    await vi.advanceTimersByTimeAsync(600);
    made.edited();
    await vi.advanceTimersByTimeAsync(600);
    expect(saves).toEqual([]);
    await vi.advanceTimersByTimeAsync(400);
    expect(saves).toEqual([false]);
    expect(states).toEqual(["edited", "edited", "saving", "saved"]);
    expect(made.isClean()).toBe(true);
  });

  it("writes again for an edit made while the file was being written", async () => {
    let finish = (): void => {};
    const { made, states, saves } = saver(() => new Promise<void>((resolve) => (finish = resolve)));
    made.edited();
    await vi.advanceTimersByTimeAsync(1_000);
    made.edited();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(states[states.length - 1]).toBe("edited");
    expect(made.isClean()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(saves).toEqual([false, false]);
    expect(states[states.length - 1]).toBe("saved");
  });

  it("writes at once when asked, and not at all with nothing to write", async () => {
    const { made, saves } = saver();
    await made.saveNow();
    expect(saves).toEqual([]);
    made.edited();
    await made.saveNow();
    expect(saves).toEqual([false]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(saves).toEqual([false]);
  });

  it("stops writing when another program changed the file, until the user keeps their text", async () => {
    let theirs = true;
    const { made, states, saves } = saver(async (overChanges) => {
      if (theirs && !overChanges) throw new FileConflictError(1);
      theirs = false;
    });
    made.edited();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(states[states.length - 1]).toBe("conflict");
    made.edited();
    await vi.advanceTimersByTimeAsync(5_000);
    await made.saveNow();
    expect(saves).toEqual([false]);
    await made.keepMine();
    expect(saves).toEqual([false, true]);
    expect(states[states.length - 1]).toBe("saved");
    made.edited();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saves).toEqual([false, true, false]);
  });

  it("says why a write failed, and tries again after the next edit", async () => {
    let fail = true;
    const { made, states, saves } = saver(async () => {
      if (fail) throw new Error("disk full");
    });
    made.edited();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(states[states.length - 1]).toBe("failed");
    expect(made.isClean()).toBe(false);
    fail = false;
    made.edited();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saves).toEqual([false, false]);
    expect(states[states.length - 1]).toBe("saved");
  });

  it("takes a conflict found before any write", async () => {
    const { made, states, saves } = saver();
    made.edited();
    made.conflicted();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(saves).toEqual([]);
    expect(states[states.length - 1]).toBe("conflict");
  });
});

describe("how long after an edit a large file is written", () => {
  it.each([
    [3 * 1024 * 1024, 1_000],
    [500 * 1024 * 1024, 10_486],
    [10 * 1024 ** 3, 120_000],
  ])("a file of %i bytes waits %i ms", (bytes, delay) => {
    expect(autosaveDelayMs(bytes)).toBe(delay);
  });
});
