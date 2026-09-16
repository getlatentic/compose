// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FileNotFoundError } from "../../lib/workspace/fileErrors";

const ipc = vi.hoisted(() => ({
  readFile: vi.fn(),
  externalReadFile: vi.fn(),
}));
vi.mock("../../lib/ipc/filesClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/ipc/filesClient")>();
  return { ...original, readFile: ipc.readFile };
});
vi.mock("../../lib/ipc/externalFilesClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/ipc/externalFilesClient")>();
  return { ...original, externalReadFile: ipc.externalReadFile };
});

const toast = vi.hoisted(() => ({ showErrorToast: vi.fn() }));
vi.mock("../../features/toast/toastStore", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../features/toast/toastStore")>();
  return { ...original, showErrorToast: toast.showErrorToast };
});

const persistence = vi.hoisted(() => ({ persistTabs: vi.fn() }));
vi.mock("./persistence", async (importOriginal) => {
  const original = await importOriginal<typeof import("./persistence")>();
  return { ...original, persistTabs: persistence.persistTabs };
});

const { loadBufferIfMissing } = await import("./filesSlice");

const LOOSE = "/Users/me/Downloads/gone.md";

function store(over: Record<string, unknown>) {
  let state = {
    focusedArea: "loose",
    workspaces: [
      {
        id: "loose",
        kind: "loose",
        scanState: "ready",
        files: [{ relativePath: LOOSE }],
        openFilePaths: [LOOSE],
        activeFilePath: LOOSE,
        fileContents: {},
        ...over,
      },
    ],
  };
  const get = () => state as never;
  const set = (patch: unknown) => {
    const next = typeof patch === "function" ? (patch as (s: unknown) => object)(state) : patch;
    state = { ...state, ...(next as object) } as typeof state;
  };
  return { get, set: set as never, workspace: () => state.workspaces[0] };
}

beforeEach(() => {
  ipc.readFile.mockReset();
  ipc.externalReadFile.mockReset();
  toast.showErrorToast.mockClear();
  persistence.persistTabs.mockClear();
});

describe("a tab whose file cannot be read", () => {
  it("closes, and says so, when the file is gone but still listed", async () => {
    // The loose list is the registry of files the user opened, which outlives
    // the file: without this the tab sits on "Still opening…" for good.
    ipc.externalReadFile.mockRejectedValue(new FileNotFoundError("No such file or directory"));
    const { get, set, workspace } = store({});

    await loadBufferIfMissing(set, get, "loose", LOOSE);

    expect(workspace().openFilePaths).toEqual([]);
    expect(toast.showErrorToast).toHaveBeenCalledWith(expect.stringContaining(LOOSE));
  });

  it("closes quietly when the list has already dropped the file", async () => {
    // The tree no longer offers it, so the tab going is the expected end of it.
    ipc.readFile.mockRejectedValue(new Error("read hiccup"));
    const { get, set, workspace } = store({ id: "ws", kind: "directory", files: [] });

    await loadBufferIfMissing(set, get, "ws", LOOSE);

    expect(workspace().openFilePaths).toEqual([]);
    expect(toast.showErrorToast).not.toHaveBeenCalled();
  });

  it("keeps the tab when the read merely failed and the file is still listed", async () => {
    // A permissions blip or an evicted iCloud copy is not a missing file:
    // closing the tab would throw away what the user was reading.
    ipc.readFile.mockRejectedValue(new Error("Operation not permitted"));
    const { get, set, workspace } = store({ id: "ws", kind: "directory" });

    await loadBufferIfMissing(set, get, "ws", LOOSE);

    expect(workspace().openFilePaths).toEqual([LOOSE]);
    expect(toast.showErrorToast).toHaveBeenCalledWith("Operation not permitted");
  });
});
