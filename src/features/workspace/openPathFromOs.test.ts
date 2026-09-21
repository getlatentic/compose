// @vitest-environment jsdom
//
// Paths the OS hands Compose, against the real store with the IPC layer mocked:
// a folder opens as a workspace, a note in a workspace opens in place.
import { beforeEach, describe, expect, it, vi } from "vitest";

const externalFiles = vi.hoisted(() => ({
  resolveOpenPath: vi.fn(),
  externalList: vi.fn(async () => ({ files: [], openPaths: [], activePath: "" })),
}));
vi.mock("../../lib/ipc/externalFilesClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/ipc/externalFilesClient")>();
  return { ...original, ...externalFiles };
});

const workspaces = vi.hoisted(() => ({
  addWorkspace: vi.fn(),
  saveWorkspaceTabs: vi.fn(async () => {}),
  switchWorkspace: vi.fn(async () => ({})),
}));
vi.mock("../../lib/ipc/workspaceClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/ipc/workspaceClient")>();
  return { ...original, ...workspaces };
});
vi.mock("../../lib/runtime/desktopRuntime", () => ({ isTauriRuntime: () => true }));

import { useWorkspaceStore } from "../../app/workspaceStore";
import { openPathFromOs } from "./useExternalFileOpen";

const VAULT = { id: "vault-id", name: "Obsidian Vault", path: "/Users/me/Obsidian Vault", lastOpenedAt: 2 };
const NOTES = { id: "notes-id", name: "Notes", path: "/Users/me/Notes", lastOpenedAt: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.getState().hydrateWorkspaces({ activeWorkspaceId: NOTES.id, onboarding: {}, workspaces: [NOTES] });
});

describe("a path the OS hands Compose", () => {
  it("opens a folder as a workspace and shows it", async () => {
    externalFiles.resolveOpenPath.mockResolvedValue({ kind: "folder", path: VAULT.path });
    workspaces.addWorkspace.mockResolvedValue({ activeWorkspaceId: VAULT.id, onboarding: {}, workspaces: [NOTES, VAULT] });

    await openPathFromOs(VAULT.path);

    expect(workspaces.addWorkspace).toHaveBeenCalledWith(VAULT.path);
    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBe(VAULT.id);
    expect(state.workspaces.map((workspace) => workspace.name)).toContain("Obsidian Vault");
  });

  it("opens a note in a workspace in place, adding nothing", async () => {
    externalFiles.resolveOpenPath.mockResolvedValue({ kind: "workspace", workspaceId: NOTES.id, relativePath: "idea.md" });

    await openPathFromOs("/Users/me/Notes/idea.md");

    expect(workspaces.addWorkspace).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe(NOTES.id);
  });
});
