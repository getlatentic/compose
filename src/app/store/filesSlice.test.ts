// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  writeFile: vi.fn(async () => ({}) as never),
  externalWriteFile: vi.fn(async () => ({}) as never),
}));
vi.mock("../../lib/ipc/filesClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/ipc/filesClient")>();
  return { ...original, writeFile: ipc.writeFile };
});
vi.mock("../../lib/ipc/externalFilesClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/ipc/externalFilesClient")>();
  return { ...original, externalWriteFile: ipc.externalWriteFile };
});

const flushActiveEditor = vi.hoisted(() => vi.fn());
vi.mock("../../lib/editor/editorFlush", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/editor/editorFlush")>();
  return { ...original, flushActiveEditor };
});

const { commitOutgoingFile, settleLooseFocus, writeBufferFor } = await import("./filesSlice");

beforeEach(() => {
  ipc.writeFile.mockClear();
  ipc.externalWriteFile.mockClear();
  flushActiveEditor.mockClear();
});

function buffer(over: Record<string, unknown> = {}) {
  return { content: "body", lastModifiedMs: 10, dirty: false, conflict: false, ...over } as never;
}

describe("where a save is written", () => {
  it("routes a loose file to the external path and a workspace file to its own", () => {
    // The two containers are different commands against different roots.
    // Crossing them writes outside the workspace, or fails to find the file.
    writeBufferFor({ kind: "loose", id: "loose" } as never, "/abs/note.md", buffer());
    expect(ipc.externalWriteFile).toHaveBeenCalledTimes(1);
    expect(ipc.writeFile).not.toHaveBeenCalled();

    writeBufferFor({ kind: "directory", id: "ws" } as never, "note.md", buffer());
    expect(ipc.writeFile).toHaveBeenCalledTimes(1);
  });

  it("sends the last-known mtime so a change under us is caught", () => {
    // The backend compares it and refuses when the file moved on. Sending null
    // means every write is unconditional and clobbers whatever arrived.
    writeBufferFor({ kind: "directory", id: "ws" } as never, "note.md", buffer());
    expect(ipc.writeFile.mock.calls[0]?.[3]).toBe(10);
  });

  it("sends nothing to compare once the user is resolving a conflict", () => {
    // Resolving *is* the decision to overwrite. Still sending the stale mtime
    // makes the write fail again on the same conflict, forever.
    writeBufferFor(
      { kind: "directory", id: "ws" } as never,
      "note.md",
      buffer({ conflict: true }),
    );
    expect(ipc.writeFile.mock.calls[0]?.[3]).toBeNull();
  });
});

describe("saving the outgoing file before the editor swaps documents", () => {
  function store(active: string | null, dirty: boolean, saveActiveFile = vi.fn()) {
    const workspace = {
      id: "ws",
      activeFilePath: active,
      fileContents: active ? { [active]: { dirty } } : {},
    };
    return {
      get: (() => ({
        focusedWorkspace: () => workspace,
        saveActiveFile,
      })) as never,
      saveActiveFile,
    };
  }

  it("flushes the editor and saves when the outgoing file is dirty", () => {
    // The editor debounces for 500ms. Switching without flushing drops
    // whatever was typed inside that window — silently, on every tab switch.
    const { get, saveActiveFile } = store("notes.md", true);
    commitOutgoingFile(get, { id: "ws", path: "other.md" });
    expect(flushActiveEditor).toHaveBeenCalled();
    expect(saveActiveFile).toHaveBeenCalled();
  });

  it("flushes but does not write when nothing changed", () => {
    // A write per tab click would touch mtimes and wake the watcher for files
    // the user only looked at.
    const { get, saveActiveFile } = store("notes.md", false);
    commitOutgoingFile(get, { id: "ws", path: "other.md" });
    expect(flushActiveEditor).toHaveBeenCalled();
    expect(saveActiveFile).not.toHaveBeenCalled();
  });

  it("does nothing when the destination is the file already open", () => {
    // Re-selecting the current tab is not a switch; flushing there would
    // interrupt typing mid-word.
    const { get, saveActiveFile } = store("notes.md", true);
    commitOutgoingFile(get, { id: "ws", path: "notes.md" });
    expect(flushActiveEditor).not.toHaveBeenCalled();
    expect(saveActiveFile).not.toHaveBeenCalled();
  });

  it("does nothing when no file is focused", () => {
    const { get, saveActiveFile } = store(null, false);
    commitOutgoingFile(get, { id: "ws", path: "notes.md" });
    expect(flushActiveEditor).not.toHaveBeenCalled();
    expect(saveActiveFile).not.toHaveBeenCalled();
  });
});

describe("handing the editor back after a loose tab closes", () => {
  function get(focusedArea: string, looseActive: string | null) {
    return (() => ({
      focusedArea,
      workspaces: [{ kind: "loose", activeFilePath: looseActive }],
    })) as never;
  }

  it("returns focus to the workspace when the loose area empties", () => {
    // Otherwise the editor keeps pointing at a closed tab and renders nothing.
    const set = vi.fn();
    settleLooseFocus(set, get("loose", null));
    expect(set).toHaveBeenCalledWith({ focusedArea: "workspace" });
  });

  it("leaves focus alone while a loose file is still open", () => {
    const set = vi.fn();
    settleLooseFocus(set, get("loose", "/abs/other.md"));
    expect(set).not.toHaveBeenCalled();
  });

  it("does not steal focus from the workspace area", () => {
    // Closing a background loose tab must not yank the user out of the file
    // they are editing.
    const set = vi.fn();
    settleLooseFocus(set, get("workspace", null));
    expect(set).not.toHaveBeenCalled();
  });
});
