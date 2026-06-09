import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";
import type { WorkspaceWriteResult } from "./filesClient";

/**
 * Git-free document version history IPC leaf. Backs the "restore previous
 * version" UI: list a file's recent saved versions and write a chosen one
 * back. Mirrors `compose::db::history` + the `workspace_list_versions` /
 * `workspace_restore_version` commands. Desktop-only — the version store is
 * SQLite, which the browser preview's virtual workspace doesn't have.
 */

/** One restorable prior version of a document, newest first in a list. */
export interface DocumentVersion {
  revisionId: string;
  /** When this version was captured (epoch ms). */
  createdAt: number;
  /** Byte length of the stored content. */
  sizeBytes: number;
  /** True when this version matches the file's current on-disk content. */
  isCurrent: boolean;
}

/** Recent restorable versions of a file, newest first. Empty in the browser. */
export async function listVersions(
  workspaceId: string,
  relativePath: string,
  limit?: number,
): Promise<DocumentVersion[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<DocumentVersion[]>("workspace_list_versions", {
    workspaceId,
    relativePath,
    limit,
  });
}

/** Restore a prior version, writing it back atomically (itself undoable). */
export async function restoreVersion(
  workspaceId: string,
  relativePath: string,
  revisionId: string,
): Promise<WorkspaceWriteResult> {
  if (!isTauriRuntime()) {
    throw new Error("Restoring a previous version requires the desktop runtime.");
  }
  return invoke<WorkspaceWriteResult>("workspace_restore_version", {
    workspaceId,
    relativePath,
    revisionId,
  });
}
