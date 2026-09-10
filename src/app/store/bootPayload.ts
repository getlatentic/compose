/**
 * The launch screen's data, handed over by the native side before this bundle
 * ran — see `src-tauri/src/boot_payload.rs`. The workspace list, the active
 * vault's file tree and the open document are injected as a page global before
 * the document is parsed, so the store below is *seeded* with them and the
 * first render is the finished app rather than an empty shell that fills in a
 * pane at a time.
 *
 * The payload is an optimisation, never a source of truth: it is absent in the
 * browser preview, on a first launch with nothing on disk, and whenever the
 * native read missed its deadline. The IPC fan-out that used to be the only
 * path still runs and still has the last word.
 */

import type { ExternalFilesList } from "../../lib/ipc/externalFilesClient";
import type { WorkspaceFileEntry } from "../../lib/ipc/filesClient";
import type { WorkspaceListResult } from "../../lib/ipc/workspaceClient";
import {
  applyExternalFiles,
  applyFileBuffer,
  applyFileSnapshot,
  createLooseWorkspace,
  hydrateWorkspaceRecords,
  type Workspace,
} from "../workspaceModel";
import type { WorkspaceState } from "./types";

interface BootActiveFile {
  content: string;
  lastModifiedMs: number;
  relativePath: string;
  workspaceId: string;
}

export interface BootPayload {
  activeFile: BootActiveFile | null;
  externalFiles: ExternalFilesList | null;
  files: WorkspaceFileEntry[];
  folders: string[];
  workspaces: WorkspaceListResult;
}

function readGlobal(): BootPayload | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = (window as { __COMPOSE_BOOT__?: unknown }).__COMPOSE_BOOT__;
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const payload = raw as Partial<BootPayload>;
  // The workspace list is the one field the seed can't be built without.
  if (!payload.workspaces || !Array.isArray(payload.workspaces.workspaces)) {
    return null;
  }
  return {
    activeFile: payload.activeFile ?? null,
    externalFiles: payload.externalFiles ?? null,
    files: Array.isArray(payload.files) ? payload.files : [],
    folders: Array.isArray(payload.folders) ? payload.folders : [],
    workspaces: payload.workspaces,
  };
}

const BOOT_PAYLOAD = readGlobal();

/** The payload this launch was given, or null when there wasn't one. */
export function bootPayload(): BootPayload | null {
  return BOOT_PAYLOAD;
}

/**
 * Initial workspace-store state built from the payload — spread over the
 * slices' own defaults at store creation, so it is in place before the first
 * render rather than applied by an effect after one.
 */
export function bootSeed(): Partial<WorkspaceState> {
  const payload = BOOT_PAYLOAD;
  if (!payload) {
    return {};
  }
  const { activeWorkspaceId, onboarding, workspaces: records } = payload.workspaces;
  const real = hydrateWorkspaceRecords([], records).map((workspace) =>
    workspace.id === activeWorkspaceId ? seedActiveWorkspace(workspace, payload) : workspace,
  );
  const loose = payload.externalFiles
    ? applyExternalFiles(createLooseWorkspace(), payload.externalFiles)
    : createLooseWorkspace();
  return {
    activeWorkspaceId: activeWorkspaceId ?? real[0]?.id ?? null,
    onboarding,
    workspaces: [...real, loose],
  };
}

/** The tree and the open document, on the workspace that will be showing them.
 *  The buffer is applied only when it is still the file the tabs point at — a
 *  payload can only ever be as fresh as the moment it was read. */
function seedActiveWorkspace(workspace: Workspace, payload: BootPayload): Workspace {
  // Folders as well as files: a folder with no markdown file in it is invisible
  // to the file list, and those rows arriving late are a visible reflow.
  const seeded = applyFileSnapshot(
    payload.folders.length > 0 ? { ...workspace, folders: payload.folders } : workspace,
    payload.files,
  );
  const active = payload.activeFile;
  if (!active || active.workspaceId !== seeded.id || active.relativePath !== seeded.activeFilePath) {
    return seeded;
  }
  return applyFileBuffer(seeded, active.relativePath, active);
}
