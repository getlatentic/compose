// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const files = vi.hoisted(() => ({
  createFile: vi.fn(async () => ({ lastModifiedMs: 50 })),
  writeFile: vi.fn(async () => ({ lastModifiedMs: 60 })),
  renameFile: vi.fn(async () => {}),
  deleteFolder: vi.fn(async () => {}),
}));
vi.mock("../../lib/ipc/filesClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/ipc/filesClient")>();
  return { ...original, ...files };
});
vi.mock("../../lib/ipc/workspaceClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/ipc/workspaceClient")>();
  return { ...original, saveWorkspaceTabs: vi.fn(async () => {}) };
});
const flushActiveEditor = vi.hoisted(() => vi.fn());
vi.mock("../../lib/editor/editorFlush", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/editor/editorFlush")>();
  return { ...original, flushActiveEditor };
});
vi.mock("../../lib/runtime/desktopRuntime", () => ({ isTauriRuntime: () => true }));

import { applyFileBuffer } from "../workspace/files";
import { createWorkspaceFromPath } from "../workspace/workspaces";
import { openWorkspaceFile } from "../workspace/tabs";
import type { Workspace } from "../workspace/types";
import { useWorkspaceStore } from "../workspaceStore";

const ws = () => useWorkspaceStore.getState().workspaces.find((w) => w.id === "ws")!;
const store = () => useWorkspaceStore.getState();

function setUp(paths: string[], active: string, folders: string[] = [], dirty: string[] = []) {
  let workspace: Workspace = {
    ...createWorkspaceFromPath("/tmp/notes"),
    id: "ws",
    scanState: "ready",
    folders,
    files: paths.map((relativePath) => ({ relativePath, lastModifiedMs: 1, sizeBytes: 1 })),
  };
  for (const path of paths) {
    workspace = applyFileBuffer(workspace, path, { content: `${path} text`, lastModifiedMs: 1 });
    workspace = openWorkspaceFile(workspace, path);
    if (dirty.includes(path)) {
      workspace = { ...workspace, fileContents: { ...workspace.fileContents, [path]: { ...workspace.fileContents[path], dirty: true } } };
    }
  }
  workspace = openWorkspaceFile(workspace, active);
  useWorkspaceStore.setState({ workspaces: [workspace], activeWorkspaceId: "ws", focusedArea: "workspace", navHistory: [], navIndex: -1, newNoteDir: "" });
}

beforeEach(() => {
  for (const mock of [...Object.values(files), flushActiveEditor]) mock.mockClear();
});

describe("renaming a file by its path", () => {
  it("renames the file it is given and leaves the open note alone", async () => {
    setUp(["a.md", "b.md"], "a.md");
    await store().renameFile("b.md", "c.md");
    expect(files.renameFile).toHaveBeenCalledWith("ws", "b.md", "c.md");
    expect(ws().activeFilePath).toBe("a.md");
    expect(ws().files.map((entry) => entry.relativePath)).toEqual(["a.md", "c.md"]);
    expect(ws().fileContents["c.md"]?.content).toBe("b.md text");
    expect(flushActiveEditor).not.toHaveBeenCalled();
  });

  it("still renames the open note through renameActiveFile, flushing it first", async () => {
    setUp(["a.md", "b.md"], "a.md");
    await store().renameActiveFile("z.md");
    expect(files.renameFile).toHaveBeenCalledWith("ws", "a.md", "z.md");
    expect(ws().activeFilePath).toBe("z.md");
    expect(flushActiveEditor).toHaveBeenCalledTimes(1);
  });

  it("points Back and Forward at the new name", async () => {
    setUp(["a.md", "b.md"], "a.md");
    useWorkspaceStore.setState({
      navHistory: [
        { kind: "file", id: "b.md", workspaceId: "ws" },
        { kind: "file", id: "a.md", workspaceId: "ws" },
      ],
      navIndex: 1,
    });
    await store().renameFile("b.md", "c.md");
    expect(store().navHistory.map((entry) => entry.id)).toEqual(["c.md", "a.md"]);
    expect(store().navIndex).toBe(1);
  });
});

describe("deleting a folder", () => {
  it("saves the unsaved notes inside it before they go to the trash, and no others", async () => {
    setUp(["Talks/x.md", "Talks/y.md", "other.md"], "Talks/x.md", ["Talks"], ["Talks/x.md", "other.md"]);
    await store().deleteFolder("Talks");
    expect(flushActiveEditor).toHaveBeenCalledTimes(1);
    expect(files.writeFile.mock.calls.map((call) => (call as unknown[])[1])).toEqual(["Talks/x.md"]);
    expect(files.writeFile.mock.invocationCallOrder[0]).toBeLessThan(files.deleteFolder.mock.invocationCallOrder[0]);
    expect(ws().files.map((entry) => entry.relativePath)).toEqual(["other.md"]);
  });
});

describe("where a new note goes", () => {
  it("goes in the folder chosen in the tree", async () => {
    setUp(["a.md"], "a.md", ["Ideas"]);
    store().setNewNoteDir("Ideas");
    await store().createNote();
    expect(files.createFile.mock.calls[0]).toEqual(["ws", "Ideas/untitled-1.md", expect.any(String)]);
  });

  it("goes to the top level once the chosen folder is gone", async () => {
    setUp(["a.md"], "a.md", ["Ideas"]);
    store().setNewNoteDir("Gone");
    await store().createNote();
    expect(files.createFile.mock.calls[0]).toEqual(["ws", "untitled-1.md", expect.any(String)]);
  });
});
