/**
 * Persistence backend for the browser virtual workspace.
 *
 * The user's chosen model: in the browser there is no live folder — files
 * are *copied in* to a virtual workspace and edited there. This backend is
 * what makes that workspace survive a reload, using the **Origin Private
 * File System** (OPFS): a real file-like, origin-scoped sandbox FS.
 *
 * Feature-detected: in environments without OPFS (Node / vitest, or an old
 * browser) `createWorkspacePersistence()` returns a no-op backend, so the
 * virtual workspace degrades to exactly today's in-memory, ephemeral Map —
 * which is why `filesClient`'s node tests keep passing unchanged.
 */

export interface PersistedFile {
  content: string;
  lastModifiedMs: number;
}

export interface WorkspacePersistence {
  /** All files for a workspace, keyed by relative path. Empty if none. */
  load(workspaceId: string): Promise<Map<string, PersistedFile>>;
  put(workspaceId: string, relativePath: string, file: PersistedFile): Promise<void>;
  remove(workspaceId: string, relativePath: string): Promise<void>;
  /** Drop every file for a workspace (used before an import replaces it). */
  clear(workspaceId: string): Promise<void>;
}

/** No persistence — virtual workspace is in-memory only (Node/tests). */
class NoopPersistence implements WorkspacePersistence {
  async load(): Promise<Map<string, PersistedFile>> {
    return new Map();
  }
  async put(): Promise<void> {}
  async remove(): Promise<void> {}
  async clear(): Promise<void> {}
}

const OPFS_ROOT = "compose-workspaces";

/** OPFS-backed persistence. Browser only. */
class OpfsPersistence implements WorkspacePersistence {
  async load(workspaceId: string): Promise<Map<string, PersistedFile>> {
    const out = new Map<string, PersistedFile>();
    const dir = await this.workspaceDir(workspaceId, false);
    if (dir) {
      await collectFiles(dir, "", out);
    }
    return out;
  }

  async put(workspaceId: string, relativePath: string, file: PersistedFile): Promise<void> {
    const dir = await this.workspaceDir(workspaceId, true);
    if (!dir) return;
    const handle = await ensureFileHandle(dir, relativePath);
    const writable = await handle.createWritable();
    await writable.write(file.content);
    await writable.close();
  }

  async remove(workspaceId: string, relativePath: string): Promise<void> {
    const dir = await this.workspaceDir(workspaceId, false);
    if (!dir) return;
    await removePath(dir, relativePath);
  }

  async clear(workspaceId: string): Promise<void> {
    const root = await navigator.storage.getDirectory();
    const base = await getDirectory(root, OPFS_ROOT, false);
    if (!base) return;
    try {
      await base.removeEntry(encodeURIComponent(workspaceId), { recursive: true });
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  private async workspaceDir(
    workspaceId: string,
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | null> {
    const root = await navigator.storage.getDirectory();
    const base = await getDirectory(root, OPFS_ROOT, create);
    if (!base) return null;
    return getDirectory(base, encodeURIComponent(workspaceId), create);
  }
}

async function getDirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await parent.getDirectoryHandle(name, { create });
  } catch (error) {
    if (!create && isNotFound(error)) return null;
    throw error;
  }
}

/**
 * `FileSystemDirectoryHandle.entries()` is an async iterator over
 * `[name, handle]` pairs. Typed locally because the project's TS DOM lib
 * predates the typings for it.
 */
type DirectoryEntries = AsyncIterableIterator<[string, FileSystemHandle]>;
function directoryEntries(dir: FileSystemDirectoryHandle): DirectoryEntries {
  return (dir as unknown as { entries(): DirectoryEntries }).entries();
}

async function collectFiles(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: Map<string, PersistedFile>,
): Promise<void> {
  for await (const [name, handle] of directoryEntries(dir)) {
    const path = prefix ? `${prefix}/${name}` : name;
    // The DOM lib here doesn't narrow the handle union on `.kind`, so cast
    // explicitly after the runtime check.
    if (handle.kind === "directory") {
      await collectFiles(handle as unknown as FileSystemDirectoryHandle, path, out);
    } else {
      const file = await (handle as unknown as FileSystemFileHandle).getFile();
      out.set(path, { content: await file.text(), lastModifiedMs: file.lastModified });
    }
  }
}

async function ensureFileHandle(
  workspaceDir: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<FileSystemFileHandle> {
  const segments = relativePath.split("/");
  let dir = workspaceDir;
  for (let i = 0; i < segments.length - 1; i += 1) {
    dir = await dir.getDirectoryHandle(segments[i], { create: true });
  }
  return dir.getFileHandle(segments[segments.length - 1], { create: true });
}

async function removePath(
  workspaceDir: FileSystemDirectoryHandle,
  relativePath: string,
): Promise<void> {
  const segments = relativePath.split("/");
  let dir = workspaceDir;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const next = await getDirectory(dir, segments[i], false);
    if (!next) return;
    dir = next;
  }
  try {
    await dir.removeEntry(segments[segments.length - 1]);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotFoundError";
}

function opfsAvailable(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.storage?.getDirectory === "function" &&
    typeof FileSystemFileHandle !== "undefined"
  );
}

/** Pick OPFS when available (browser), else no-op (Node/tests/old browsers). */
export function createWorkspacePersistence(): WorkspacePersistence {
  return opfsAvailable() ? new OpfsPersistence() : new NoopPersistence();
}
