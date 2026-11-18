import { flushActiveEditor } from "../../lib/editor/editorFlush";
import { writeFile as writeFileIpc } from "../../lib/ipc/filesClient";
import type { WorkspaceStoreGet } from "./types";

/**
 * Write the unsaved edits of files about to be deleted, so the trashed copy
 * and the history snapshot the backend takes hold the user's latest work. The
 * active file's buffer lags the editor by its emit delay, so the editor is
 * flushed first. Best effort: a failed write must not block the delete the
 * user asked for, and the backend still snapshots what is on disk.
 */
export async function saveBeforeRemoval(
  get: WorkspaceStoreGet,
  workspaceId: string,
  removes: (relativePath: string) => boolean,
): Promise<void> {
  const before = get().workspaces.find((item) => item.id === workspaceId);
  if (before?.activeFilePath && removes(before.activeFilePath)) {
    flushActiveEditor();
  }
  const workspace = get().workspaces.find((item) => item.id === workspaceId);
  const dirty = Object.entries(workspace?.fileContents ?? {}).filter(
    ([path, buffer]) => buffer.dirty && removes(path),
  );
  await Promise.all(
    dirty.map(([path, buffer]) =>
      writeFileIpc(workspaceId, path, buffer.content, buffer.conflict ? null : buffer.lastModifiedMs, buffer.pendingChanges)
        .catch(() => undefined),
    ),
  );
}
