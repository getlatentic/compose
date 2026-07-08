import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../runtime/desktopRuntime";
import {
  invokeFile,
  type WorkspaceFileContent,
  type WorkspaceWriteResult,
} from "./filesClient";

/**
 * IPC surface for files opened from outside any workspace (#113): edited at
 * their real absolute path, tracked in a persisted list on the Rust side.
 * Desktop-only — the browser preview has no OS "Open with", so the list is
 * empty and IO is unreachable there.
 */

export interface ExternalFileRecord {
  path: string;
  addedAtMs: number;
}

export interface ExternalFilesList {
  files: ExternalFileRecord[];
  openPaths: string[];
  activePath: string;
}

/** Where an OS-opened path lands: selected in place inside a registered
 *  workspace, or tracked as an external file. */
export type OpenTarget =
  | { kind: "workspace"; workspaceId: string; relativePath: string }
  | { kind: "external"; path: string };

const EMPTY_LIST: ExternalFilesList = { files: [], openPaths: [], activePath: "" };

export async function externalList(): Promise<ExternalFilesList> {
  if (!isTauriRuntime()) {
    return EMPTY_LIST;
  }
  return invoke<ExternalFilesList>("external_list");
}

/** Register a file; returns the canonical path it was stored under (symlinks
 *  and `/tmp` → `/private/tmp` resolved) plus the updated list. */
export async function externalAdd(
  path: string,
): Promise<{ path: string; list: ExternalFilesList }> {
  return invoke<{ path: string; list: ExternalFilesList }>("external_add", { path });
}

export async function externalRemove(path: string): Promise<ExternalFilesList> {
  return invoke<ExternalFilesList>("external_remove", { path });
}

export async function externalSaveTabs(openPaths: string[], activePath: string): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  await invoke("external_save_tabs", { openPaths, activePath });
}

export async function externalReadFile(path: string): Promise<WorkspaceFileContent> {
  return invokeFile<WorkspaceFileContent>("external_read_file", { path });
}

export async function externalWriteFile(
  path: string,
  content: string,
  expectedLastModifiedMs: number | null,
): Promise<WorkspaceWriteResult> {
  return invokeFile<WorkspaceWriteResult>("external_write_file", {
    path,
    content,
    expectedLastModifiedMs,
  });
}

export async function resolveOpenPath(path: string): Promise<OpenTarget> {
  return invoke<OpenTarget>("resolve_open_path", { path });
}
