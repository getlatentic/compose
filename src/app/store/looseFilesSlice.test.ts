// @vitest-environment jsdom
//
// External files (#113): the loose pseudo-workspace's lifecycle against the
// real store, with the IPC layer mocked. Covers the acceptance points that
// belong to the store: open-registers-and-focuses, IO routed by container,
// focus handoff on select/close, removal (incl. nav pruning), and boot
// hydration of the persisted list.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const externalFiles = vi.hoisted(() => ({
  externalAdd: vi.fn(),
  externalRemove: vi.fn(),
  externalSaveTabs: vi.fn(async () => {}),
  externalReadFile: vi.fn(),
  externalWriteFile: vi.fn(),
  externalList: vi.fn(async () => ({ files: [], openPaths: [], activePath: "" })),
  resolveOpenPath: vi.fn(),
}));
vi.mock("../../lib/ipc/externalFilesClient", () => externalFiles);

const workspaceFiles = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));
vi.mock("../../lib/ipc/filesClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/ipc/filesClient")>();
  return { ...original, readFile: workspaceFiles.readFile, writeFile: workspaceFiles.writeFile };
});
// Tab persistence for REAL workspaces goes through the workspace client; keep
// it inert so selectFile in tests doesn't hit Tauri.
vi.mock("../../lib/ipc/workspaceClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/ipc/workspaceClient")>();
  return {
    ...original,
    saveWorkspaceTabs: vi.fn(async () => {}),
    switchWorkspace: vi.fn(async () => ({})),
  };
});
vi.mock("../../lib/runtime/desktopRuntime", () => ({ isTauriRuntime: () => true }));

import { useWorkspaceStore } from "../workspaceStore";
import {
  LOOSE_WORKSPACE_ID,
  createLooseWorkspace,
  createWorkspaceFromPath,
  openWorkspaceFile,
} from "../workspaceModel";

const NOTE = "/Users/someone/Downloads/readme.md";

function seedRealWorkspace() {
  const workspace = {
    ...createWorkspaceFromPath("/Users/someone/Notes"),
    id: "ws-1",
    files: [{ relativePath: "a.md", lastModifiedMs: 1, sizeBytes: 1 }],
  };
  useWorkspaceStore.setState({
    workspaces: [openWorkspaceFile(workspace, "a.md"), createLooseWorkspace()],
    activeWorkspaceId: "ws-1",
    focusedArea: "workspace",
    navHistory: [],
    navIndex: -1,
  });
}

function loose() {
  const found = useWorkspaceStore.getState().workspaces.find((w) => w.kind === "loose");
  if (!found) throw new Error("loose workspace missing");
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  externalFiles.externalAdd.mockImplementation(async (path: string) => ({
    path,
    list: { files: [{ path, addedAtMs: 1 }], openPaths: [], activePath: "" },
  }));
  externalFiles.externalRemove.mockResolvedValue({ files: [], openPaths: [], activePath: "" });
  externalFiles.externalReadFile.mockResolvedValue({ content: "# external", lastModifiedMs: 10 });
  externalFiles.externalWriteFile.mockResolvedValue({ lastModifiedMs: 20 });
  workspaceFiles.readFile.mockResolvedValue({ content: "# workspace", lastModifiedMs: 5 });
  workspaceFiles.writeFile.mockResolvedValue({ lastModifiedMs: 6 });
  seedRealWorkspace();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("openLooseFile", () => {
  it("registers the file, opens its tab focused, and reads via external IO", async () => {
    await useWorkspaceStore.getState().openLooseFile(NOTE);

    expect(externalFiles.externalAdd).toHaveBeenCalledWith(NOTE);
    expect(externalFiles.externalReadFile).toHaveBeenCalledWith(NOTE);
    expect(workspaceFiles.readFile).not.toHaveBeenCalled();

    const state = useWorkspaceStore.getState();
    expect(state.focusedArea).toBe("loose");
    expect(loose().openFilePaths).toEqual([NOTE]);
    expect(loose().activeFilePath).toBe(NOTE);
    expect(loose().fileContents[NOTE]?.content).toBe("# external");
    // The real workspace stays the ACTIVE one throughout — the tree/chat
    // never leave it.
    expect(state.activeWorkspaceId).toBe("ws-1");
    // Tabs persisted to the external registry, not workspaces.json.
    expect(externalFiles.externalSaveTabs).toHaveBeenCalledWith([NOTE], NOTE);
  });

  it("keys the buffer on the canonical path the registry reports", async () => {
    const canonical = "/private/tmp/readme.md";
    externalFiles.externalAdd.mockResolvedValue({
      path: canonical,
      list: { files: [{ path: canonical, addedAtMs: 1 }], openPaths: [], activePath: "" },
    });

    await useWorkspaceStore.getState().openLooseFile("/tmp/readme.md");

    expect(loose().activeFilePath).toBe(canonical);
    expect(externalFiles.externalReadFile).toHaveBeenCalledWith(canonical);
  });

  it("surfaces a failed add without focusing the loose area", async () => {
    externalFiles.externalAdd.mockRejectedValue(new Error("only Markdown files"));

    await useWorkspaceStore.getState().openLooseFile("/tmp/photo.png");

    expect(useWorkspaceStore.getState().focusedArea).toBe("workspace");
    expect(loose().openFilePaths).toEqual([]);
  });
});

describe("editor routing while a loose file is focused", () => {
  beforeEach(async () => {
    await useWorkspaceStore.getState().openLooseFile(NOTE);
  });

  it("activeFileBuffer reads the loose buffer; saveActiveFile writes external", async () => {
    expect(useWorkspaceStore.getState().activeFileBuffer()?.content).toBe("# external");

    useWorkspaceStore.getState().updateActiveContent("# edited");
    expect(loose().fileContents[NOTE]?.dirty).toBe(true);
    // The real workspace's buffer is untouched by the focused edit.
    expect(
      useWorkspaceStore.getState().workspaces.find((w) => w.id === "ws-1")?.fileContents["a.md"],
    ).toBeUndefined();

    await useWorkspaceStore.getState().saveActiveFile();
    expect(externalFiles.externalWriteFile).toHaveBeenCalledWith(NOTE, "# edited", 10);
    expect(workspaceFiles.writeFile).not.toHaveBeenCalled();
    expect(loose().fileContents[NOTE]?.dirty).toBe(false);
  });

  it("selectFile hands focus back to the workspace and saves the outgoing loose edit", async () => {
    useWorkspaceStore.getState().updateActiveContent("# edited");

    await useWorkspaceStore.getState().selectFile("a.md");

    const state = useWorkspaceStore.getState();
    expect(state.focusedArea).toBe("workspace");
    expect(state.activeWorkspace()?.activeFilePath).toBe("a.md");
    // The dirty loose buffer was flushed to disk on the way out (#43).
    expect(externalFiles.externalWriteFile).toHaveBeenCalledWith(NOTE, "# edited", 10);
  });

  it("saveAllDirtyBuffers covers loose buffers alongside workspace ones", async () => {
    useWorkspaceStore.getState().updateActiveContent("# edited");

    await useWorkspaceStore.getState().saveAllDirtyBuffers();

    expect(externalFiles.externalWriteFile).toHaveBeenCalledWith(NOTE, "# edited", 10);
  });

  it("closing the focused loose tab returns focus to the workspace", () => {
    useWorkspaceStore.getState().closeLooseTab(NOTE);

    const state = useWorkspaceStore.getState();
    expect(state.focusedArea).toBe("workspace");
    expect(loose().openFilePaths).toEqual([]);
    expect(loose().activeFilePath).toBe("");
  });
});

describe("removeLooseFile", () => {
  it("drops the entry, its tab, and its nav entries; disk file is untouched", async () => {
    await useWorkspaceStore.getState().openLooseFile(NOTE);

    await useWorkspaceStore.getState().removeLooseFile(NOTE);

    expect(externalFiles.externalRemove).toHaveBeenCalledWith(NOTE);
    const state = useWorkspaceStore.getState();
    expect(state.focusedArea).toBe("workspace");
    expect(loose().files).toEqual([]);
    expect(loose().openFilePaths).toEqual([]);
    expect(
      state.navHistory.some(
        (entry) => entry.workspaceId === LOOSE_WORKSPACE_ID && entry.id === NOTE,
      ),
    ).toBe(false);
  });

  it("saves a dirty buffer before removing, so typed work isn't lost", async () => {
    await useWorkspaceStore.getState().openLooseFile(NOTE);
    useWorkspaceStore.getState().updateActiveContent("# last words");

    await useWorkspaceStore.getState().removeLooseFile(NOTE);

    expect(externalFiles.externalWriteFile).toHaveBeenCalledWith(NOTE, "# last words", 10);
  });

  it("never force-writes a CONFLICTED buffer on remove — the newer disk copy wins", async () => {
    await useWorkspaceStore.getState().openLooseFile(NOTE);
    useWorkspaceStore.getState().updateActiveContent("# stale local edit");
    // The autosave found the file changed on disk and flagged the conflict.
    useWorkspaceStore.setState((state) => ({
      workspaces: state.workspaces.map((w) =>
        w.kind === "loose"
          ? {
              ...w,
              fileContents: {
                ...w.fileContents,
                [NOTE]: { ...w.fileContents[NOTE]!, conflict: true },
              },
            }
          : w,
      ),
    }));
    externalFiles.externalWriteFile.mockClear();

    await useWorkspaceStore.getState().removeLooseFile(NOTE);

    expect(externalFiles.externalWriteFile).not.toHaveBeenCalled();
    expect(externalFiles.externalRemove).toHaveBeenCalledWith(NOTE);
  });
});

describe("hydrateExternalFiles", () => {
  it("restores the list and its open tabs without stealing focus", () => {
    useWorkspaceStore.getState().hydrateExternalFiles({
      files: [{ path: NOTE, addedAtMs: 1 }],
      openPaths: [NOTE, "/gone/other.md"],
      activePath: NOTE,
    });

    const state = useWorkspaceStore.getState();
    expect(state.focusedArea).toBe("workspace");
    expect(loose().files.map((entry) => entry.relativePath)).toEqual([NOTE]);
    // Open paths are clamped to known entries.
    expect(loose().openFilePaths).toEqual([NOTE]);
    expect(loose().activeFilePath).toBe(NOTE);
  });

  it("survives workspace re-hydration (the loose workspace is carried over)", () => {
    useWorkspaceStore.getState().hydrateExternalFiles({
      files: [{ path: NOTE, addedAtMs: 1 }],
      openPaths: [NOTE],
      activePath: NOTE,
    });

    useWorkspaceStore.getState().hydrateWorkspaces({
      activeWorkspaceId: "ws-1",
      onboarding: {},
      workspaces: [{ id: "ws-1", name: "Notes", path: "/Users/someone/Notes" }],
    });

    expect(loose().openFilePaths).toEqual([NOTE]);
    const workspaces = useWorkspaceStore.getState().workspaces;
    // Exactly one loose workspace, kept last.
    expect(workspaces.filter((w) => w.kind === "loose")).toHaveLength(1);
    expect(workspaces[workspaces.length - 1]?.kind).toBe("loose");
  });
});
