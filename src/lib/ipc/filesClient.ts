import { invoke } from "@tauri-apps/api/core";
import type { DocumentTextChange } from "../../features/comments/commentModel";
import { isTauriRuntime } from "../runtime/desktopRuntime";
import { FileConflictError, FileNotFoundError } from "../workspace/fileErrors";
import {
  _resetVirtualWorkspaceForTests,
  vwCreate,
  vwDelete,
  vwRead,
  vwRename,
  vwScan,
  vwWrite,
} from "../workspace/virtualWorkspace";

// Re-exported so existing importers (incl. filesClient.test.ts) keep
// getting it from here; the classes live in ../workspace/fileErrors.
export { FileConflictError, FileNotFoundError };

export interface WorkspaceFileEntry {
  lastModifiedMs: number;
  relativePath: string;
  sizeBytes: number;
}

export interface WorkspaceFileContent {
  content: string;
  lastModifiedMs: number;
}

export interface WorkspaceWriteResult {
  lastModifiedMs: number;
}

interface RawFileError {
  kind: "conflict" | "notFound" | "alreadyExists" | "message";
  message?: string;
  latestLastModifiedMs?: number;
}

function normalizeFileError(raw: unknown): Error {
  if (raw && typeof raw === "object" && "kind" in raw) {
    const error = raw as RawFileError;
    if (error.kind === "conflict") {
      return new FileConflictError(error.latestLastModifiedMs ?? 0);
    }
    if (error.kind === "notFound") {
      return new FileNotFoundError(error.message ?? error.kind);
    }
    return new Error(error.message ?? error.kind);
  }
  if (raw instanceof Error) {
    return raw;
  }
  if (typeof raw === "string") {
    return new Error(raw);
  }
  return new Error("File operation failed");
}

/** Invoke a file-shaped Tauri command, mapping its wire `FileError` (incl.
 *  conflicts) to typed errors. Shared with the external-files client. */
export async function invokeFile<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    throw normalizeFileError(raw);
  }
}

// In the browser, every file operation routes through the virtual
// workspace ([../workspace/virtualWorkspace.ts]) — an in-memory store
// persisted to OPFS. On the desktop it's the Tauri command against the
// real folder. Same public API either way.

export async function scanWorkspace(workspaceId: string): Promise<WorkspaceFileEntry[]> {
  if (!isTauriRuntime()) {
    return vwScan(workspaceId);
  }
  return invokeFile<WorkspaceFileEntry[]>("workspace_scan", { workspaceId });
}

/** The workspace's directories, so the tree can show folders that hold no
 *  markdown file yet. The browser preview has no real empty folders → []. */
export async function scanFolders(workspaceId: string): Promise<string[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invokeFile<string[]>("workspace_scan_folders", { workspaceId });
}

export async function readFile(
  workspaceId: string,
  relativePath: string,
): Promise<WorkspaceFileContent> {
  if (!isTauriRuntime()) {
    return vwRead(workspaceId, relativePath);
  }
  return invokeFile<WorkspaceFileContent>("workspace_read_file", {
    workspaceId,
    relativePath,
  });
}

export async function writeFile(
  workspaceId: string,
  relativePath: string,
  content: string,
  expectedLastModifiedMs: number | null,
  changes: DocumentTextChange[] = [],
): Promise<WorkspaceWriteResult> {
  if (!isTauriRuntime()) {
    return vwWrite(workspaceId, relativePath, content, expectedLastModifiedMs);
  }
  return invokeFile<WorkspaceWriteResult>("workspace_write_file", {
    workspaceId,
    relativePath,
    content,
    expectedLastModifiedMs,
    changes,
  });
}

export async function createFile(
  workspaceId: string,
  relativePath: string,
  content: string,
): Promise<WorkspaceWriteResult> {
  if (!isTauriRuntime()) {
    return vwCreate(workspaceId, relativePath, content);
  }
  return invokeFile<WorkspaceWriteResult>("workspace_create_file", {
    workspaceId,
    relativePath,
    content,
  });
}

/** Create a real empty directory (a proper "New folder"). No-op in the browser
 *  preview, which has no real filesystem; the optimistic store update still
 *  shows it for the session. */
export async function createFolder(workspaceId: string, relativePath: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invokeFile<null>("workspace_create_folder", { workspaceId, relativePath });
}

/**
 * Create (or reuse) the default starter notes folder `~/Documents/Compose`,
 * seeded with a Welcome note on first run, and return its absolute path for
 * the caller to open as a workspace. Desktop only — the browser has no real
 * filesystem, so this returns null and the caller falls back to the sample
 * workspace.
 */
export async function createStarterFolder(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  return invoke<string>("workspace_create_starter");
}

export async function writeBinaryFile(
  workspaceId: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<WorkspaceWriteResult> {
  if (!isTauriRuntime()) {
    // Browser fallback. The virtual workspace stores text; binary writes
    // (image-insert pipeline) are expected to fall back to a data URL when
    // this throws. We don't silently no-op because that'd hide a real bug
    // in the Tauri path.
    throw new Error(
      "writeBinaryFile: not available in the browser preview — Tauri runtime required",
    );
  }
  return invokeFile<WorkspaceWriteResult>("workspace_write_binary_file", {
    workspaceId,
    relativePath,
    // Tauri's IPC serializer accepts Uint8Array as a typed-array payload
    // which arrives on the Rust side as Vec<u8>.
    bytes: Array.from(bytes),
  });
}

export async function renameFile(
  workspaceId: string,
  fromRelative: string,
  toRelative: string,
): Promise<void> {
  if (!isTauriRuntime()) {
    return vwRename(workspaceId, fromRelative, toRelative);
  }
  await invokeFile<null>("workspace_rename_file", {
    workspaceId,
    fromRelative,
    toRelative,
  });
}

export async function deleteFile(workspaceId: string, relativePath: string): Promise<void> {
  if (!isTauriRuntime()) {
    return vwDelete(workspaceId, relativePath);
  }
  await invokeFile<null>("workspace_delete_file", { workspaceId, relativePath });
}

/** Move a folder and its contents to the trash (recoverable). No-op in the
 *  browser preview. */
export async function deleteFolder(workspaceId: string, relativePath: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invokeFile<null>("workspace_delete_folder", { workspaceId, relativePath });
}

export function _resetFallbackForTests() {
  _resetVirtualWorkspaceForTests();
}
