import type { HarnessReadiness } from "../../lib/ipc/harnessClient";
import { setCurrentTabContext } from "./chatContext";
import type { Workspace, WorkspaceRecord } from "./types";

/**
 * Creating and restoring workspaces, and their ids.
 */

export const LOOSE_WORKSPACE_ID = "compose:loose";

export const LOOSE_WORKSPACE_NAME = "Open files";

/** The real (folder-rooted) workspaces — every list surface (switcher,
 *  counters, setup checks) reads through this so the loose pseudo-workspace
 *  can never leak into it. */
export function realWorkspaces(workspaces: Workspace[]): Workspace[] {
  return workspaces.filter((workspace) => workspace.kind === "real");
}

export function isSetupComplete(
  selectedHarnessReadiness: HarnessReadiness | null,
  workspaces: Workspace[],
) {
  // "Set up" = the selected harness is installed and a REAL workspace exists
  // (the loose pseudo-workspace doesn't count); the key is checked at send.
  return Boolean(selectedHarnessReadiness?.installed) && realWorkspaces(workspaces).length > 0;
}

export function createWorkspaceFromPath(path: string): Workspace {
  const normalizedPath = normalizeWorkspacePath(path);

  return {
    activeFilePath: "",
    chatThread: {
      activeLlmThreadId: null,
      activeRunId: null,
      conversationId: null,
      contextItems: [],
      messages: [],
      preparedCommand: null,
      prompt: "",
      runError: null,
      runState: "idle",
    },
    comments: [],
    fileContents: {},
    files: [],
    folders: [],
    id: createWorkspaceId(normalizedPath),
    kind: "real",
    lastSavedAt: null,
    name: workspaceNameFromPath(normalizedPath),
    openFilePaths: [],
    path: normalizedPath,
    scanError: null,
    scanState: "idle",
  };
}

/**
 * Build the singleton "Open files" workspace that houses files opened
 * individually (Finder Open-With, `compose <file>`). Files added later
 * to this workspace carry **absolute** paths in their `relativePath`
 * field — every IO path that consumes a workspace branches on `kind`.
 */
export function createLooseWorkspace(): Workspace {
  return {
    activeFilePath: "",
    chatThread: {
      activeLlmThreadId: null,
      activeRunId: null,
      conversationId: null,
      contextItems: [],
      messages: [],
      preparedCommand: null,
      prompt: "",
      runError: null,
      runState: "idle",
    },
    comments: [],
    fileContents: {},
    files: [],
    folders: [],
    id: LOOSE_WORKSPACE_ID,
    kind: "loose",
    lastSavedAt: null,
    name: LOOSE_WORKSPACE_NAME,
    openFilePaths: [],
    path: "",
    scanError: null,
    scanState: "idle",
  };
}

export function createWorkspaceFromRecord(record: WorkspaceRecord): Workspace {
  const workspace = createWorkspaceFromPath(record.path);
  const restoredOpen = record.tabs?.openFilePaths ?? [];
  const restoredActive = record.tabs?.activeFilePath ?? "";

  return {
    ...workspace,
    activeFilePath: restoredActive,
    chatThread: setCurrentTabContext(workspace.chatThread, record.id, restoredActive),
    id: record.id,
    lastOpenedAt: record.lastOpenedAt,
    name: record.name,
    openFilePaths: restoredOpen,
  };
}

export function hydrateWorkspaceRecords(
  existingWorkspaces: Workspace[],
  records: WorkspaceRecord[],
) {
  return records.map((record) => {
    const existingWorkspace = existingWorkspaces.find((workspace) => workspace.id === record.id);
    if (!existingWorkspace) {
      return createWorkspaceFromRecord(record);
    }
    if (existingWorkspace.lastOpenedAt === record.lastOpenedAt) {
      return existingWorkspace;
    }
    return { ...existingWorkspace, lastOpenedAt: record.lastOpenedAt };
  });
}

export function createWorkspaceId(path: string) {
  const normalizedPath = normalizeWorkspacePath(path);
  let hash = 0x811c9dc5;

  for (const character of normalizedPath) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }

  return `workspace-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function normalizeWorkspacePath(path: string) {
  const normalizedPath = path.trim().replace(/\/+$/, "");
  if (!normalizedPath) {
    throw new Error("workspace path cannot be blank");
  }

  return normalizedPath;
}

function workspaceNameFromPath(path: string) {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}
