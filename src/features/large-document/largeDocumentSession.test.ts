// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenedPagedFile } from "../../lib/ipc/pagedClient";
import { saveLargeDocuments } from "../../lib/editor/largeDocumentSaves";
import { openLargeDocument, type LargeDocumentState } from "./largeDocumentSession";

/** What happened, in order: the calls on the file and on the view. */
let log: string[] = [];
let changedOnDisk = false;
let views: { onEdit?: () => void; onMove?: (byte: number) => void; startAt?: number }[] = [];

vi.mock("../../lib/ipc/pagedClient", () => ({
  openPagedFile: async (): Promise<OpenedPagedFile> => {
    log.push("open");
    return {
      source: { size: 3_000_000, window: vi.fn(), windowFrom: vi.fn(), windowBefore: vi.fn() },
      save: async (overChanges) => void log.push(overChanges ? "save over" : "save"),
      changedOnDisk: async () => changedOnDisk,
      close: async (discard) => void log.push(discard ? "close, dropping edits" : "close"),
    };
  },
}));

vi.mock("@latentic/live-markdown", () => ({
  createPagedMarkdownView: (_parent: HTMLElement, _source: unknown, options: (typeof views)[number]) => {
    views.push(options);
    return { sent: async () => void log.push("sent"), destroy: () => void log.push("destroy"), jumpTo: async () => {} };
  },
}));

const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function opened(path = "Big.md") {
  const states: LargeDocumentState[] = [];
  const session = openLargeDocument(document.createElement("div"), "workspace", path, {}, (state) => states.push(state));
  const last = (): string => {
    const state = states[states.length - 1];
    return state.status === "open" ? state.save.status : state.status;
  };
  return { session, last };
}

beforeEach(() => {
  log = [];
  views = [];
  changedOnDisk = false;
});

describe("a large file on screen", () => {
  it("opens, and with no edits closes without a write", async () => {
    const { session, last } = opened();
    await settled();
    expect(last()).toBe("saved");
    session.dispose();
    await settled();
    expect(log).toEqual(["open", "sent", "destroy", "close"]);
  });

  it("sends its edits, leaves the screen, and only then writes and closes", async () => {
    const { session } = opened();
    await settled();
    views[0].onEdit?.();
    session.dispose();
    await settled();
    expect(log).toEqual(["open", "sent", "destroy", "sent", "save", "close"]);
  });

  it("is saved with the rest when the app closes", async () => {
    const { session } = opened();
    await settled();
    views[0].onEdit?.();
    await saveLargeDocuments();
    expect(log).toEqual(["open", "sent", "save"]);
    session.dispose();
    await settled();
    await saveLargeDocuments();
    expect(log.filter((entry) => entry === "save")).toHaveLength(1);
  });

  it("is never shown when its screen left before it opened", async () => {
    const { session } = opened();
    session.dispose();
    await settled();
    expect(log).toEqual([]);
    expect(views).toHaveLength(0);
  });

  it("shows the file again when another program changed it and there are no edits", async () => {
    const { session, last } = opened();
    await settled();
    changedOnDisk = true;
    session.diskMayHaveChanged();
    await settled();
    expect(log).toEqual(["open", "destroy", "close, dropping edits", "open"]);
    expect(last()).toBe("saved");
  });

  it("asks the user when another program changed it and there are edits", async () => {
    const { session, last } = opened();
    await settled();
    views[0].onEdit?.();
    changedOnDisk = true;
    session.diskMayHaveChanged();
    await settled();
    expect(last()).toBe("conflict");
    expect(log).toEqual(["open"]);
    session.keepMine();
    await settled();
    expect(log).toEqual(["open", "sent", "save over"]);
    expect(last()).toBe("saved");
  });

  it("drops the edits and shows the file on disk when the user takes that version", async () => {
    const { session, last } = opened();
    await settled();
    views[0].onEdit?.();
    session.reload();
    await settled();
    expect(log).toEqual(["open", "destroy", "close, dropping edits", "open"]);
    expect(last()).toBe("saved");
  });

  it("opens again at the place it was left at, and another file at its own", async () => {
    const first = opened("Scrolled.md");
    await settled();
    expect(views[0].startAt).toBeUndefined();
    views[0].onMove?.(123_456);
    first.session.dispose();
    await settled();
    opened("Scrolled.md");
    opened("Other.md");
    await settled();
    expect(views.slice(1).map((view) => view.startAt)).toEqual([123_456, undefined]);
  });
});
