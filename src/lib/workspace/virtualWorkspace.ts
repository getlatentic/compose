/**
 * Browser virtual workspace.
 *
 * In the browser there is no live folder: files are *copied in* (folder
 * import) and edited on the copy. This module is that copy — the store
 * behind `filesClient`'s browser branch.
 *
 * Design: an in-memory hot tier (the authoritative read source + conflict
 * detection, kept synchronous-simple) plus a write-through persistence
 * backend ([workspacePersistence.ts](./workspacePersistence.ts), OPFS in
 * the browser). On first access a workspace hydrates from persistence; if
 * persistence is empty it seeds the demo files. In Node/tests the backend
 * is a no-op, so this behaves exactly like the previous ephemeral Map.
 */

import { seedWorkspaceFiles } from "../../app/seedWorkspace";
import { FileConflictError } from "./fileErrors";
import {
  createWorkspacePersistence,
  type PersistedFile,
  type WorkspacePersistence,
} from "./workspacePersistence";

export interface VirtualFileEntry {
  lastModifiedMs: number;
  relativePath: string;
  sizeBytes: number;
}

const memory = new Map<string, Map<string, PersistedFile>>();
const hydrated = new Set<string>();
let backend: WorkspacePersistence = createWorkspacePersistence();

/** Load (or seed) a workspace's files into the hot tier exactly once. */
async function ensure(workspaceId: string): Promise<Map<string, PersistedFile>> {
  let files = memory.get(workspaceId);
  if (files && hydrated.has(workspaceId)) {
    return files;
  }
  if (!files) {
    files = new Map<string, PersistedFile>();
    memory.set(workspaceId, files);
  }

  const persisted = await backend.load(workspaceId);
  if (persisted.size > 0) {
    for (const [path, file] of persisted) {
      files.set(path, file);
    }
  } else if (files.size === 0) {
    const seedTime = Date.now();
    for (const seed of seedWorkspaceFiles) {
      const file: PersistedFile = { content: seed.markdown, lastModifiedMs: seedTime };
      files.set(seed.path, file);
      await backend.put(workspaceId, seed.path, file);
    }
  }
  hydrated.add(workspaceId);
  return files;
}

export async function vwScan(workspaceId: string): Promise<VirtualFileEntry[]> {
  const files = await ensure(workspaceId);
  return [...files.entries()]
    .map(([relativePath, value]) => ({
      lastModifiedMs: value.lastModifiedMs,
      relativePath,
      sizeBytes: value.content.length,
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export async function vwRead(workspaceId: string, relativePath: string): Promise<PersistedFile> {
  const files = await ensure(workspaceId);
  const file = files.get(relativePath);
  if (!file) {
    throw new Error(`${relativePath} does not exist`);
  }
  return { content: file.content, lastModifiedMs: file.lastModifiedMs };
}

export async function vwWrite(
  workspaceId: string,
  relativePath: string,
  content: string,
  expectedLastModifiedMs: number | null,
): Promise<{ lastModifiedMs: number }> {
  const files = await ensure(workspaceId);
  const existing = files.get(relativePath);
  if (
    expectedLastModifiedMs != null &&
    existing &&
    existing.lastModifiedMs > expectedLastModifiedMs
  ) {
    throw new FileConflictError(existing.lastModifiedMs);
  }
  const file: PersistedFile = { content, lastModifiedMs: Date.now() };
  files.set(relativePath, file);
  await backend.put(workspaceId, relativePath, file);
  return { lastModifiedMs: file.lastModifiedMs };
}

export async function vwCreate(
  workspaceId: string,
  relativePath: string,
  content: string,
): Promise<{ lastModifiedMs: number }> {
  const files = await ensure(workspaceId);
  if (files.has(relativePath)) {
    throw new Error(`${relativePath} already exists`);
  }
  const file: PersistedFile = { content, lastModifiedMs: Date.now() };
  files.set(relativePath, file);
  await backend.put(workspaceId, relativePath, file);
  return { lastModifiedMs: file.lastModifiedMs };
}

export async function vwRename(
  workspaceId: string,
  fromRelative: string,
  toRelative: string,
): Promise<void> {
  const files = await ensure(workspaceId);
  const file = files.get(fromRelative);
  if (!file) {
    throw new Error(`${fromRelative} does not exist`);
  }
  if (files.has(toRelative)) {
    throw new Error(`${toRelative} already exists`);
  }
  files.delete(fromRelative);
  files.set(toRelative, file);
  await backend.remove(workspaceId, fromRelative);
  await backend.put(workspaceId, toRelative, file);
}

export async function vwDelete(workspaceId: string, relativePath: string): Promise<void> {
  const files = await ensure(workspaceId);
  if (!files.delete(relativePath)) {
    throw new Error(`${relativePath} does not exist`);
  }
  await backend.remove(workspaceId, relativePath);
}

/**
 * Copy an imported folder's files into the workspace, replacing whatever
 * was there. This is the browser "open folder" landing point.
 */
export async function vwImport(
  workspaceId: string,
  files: { relativePath: string; content: string }[],
): Promise<void> {
  await backend.clear(workspaceId);
  const fileMap = new Map<string, PersistedFile>();
  const importedAt = Date.now();
  for (const { relativePath, content } of files) {
    const file: PersistedFile = { content, lastModifiedMs: importedAt };
    fileMap.set(relativePath, file);
    await backend.put(workspaceId, relativePath, file);
  }
  memory.set(workspaceId, fileMap);
  hydrated.add(workspaceId);
}

/** Test seam: reset all in-memory state. */
export function _resetVirtualWorkspaceForTests(): void {
  memory.clear();
  hydrated.clear();
}

/** Test seam: swap the persistence backend (e.g. an in-memory fake). */
export function _setWorkspacePersistenceForTests(next: WorkspacePersistence): void {
  backend = next;
}
