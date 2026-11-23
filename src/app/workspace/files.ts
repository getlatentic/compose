import type { DocumentTextChange } from "../../features/comments/commentModel";
import type { ExternalFilesList } from "../../lib/ipc/externalFilesClient";
import { removeFileContext } from "./chatContext";
import { closeWorkspaceFileTab } from "./tabs";
import type { Workspace, WorkspaceFileEntry } from "./types";

/**
 * A workspace's files and their buffers, as scans and saves change them.
 */

/** Remove a folder and everything under it from workspace state — files,
 * folders, buffers, open tabs, chat context, and comments. The IPC delete
 * moves the folder to trash; this reconciles the in-memory state. */
export function removeWorkspaceFolder(workspace: Workspace, folderPath: string): Workspace {
  const prefix = `${folderPath}/`;
  const underFolder = (path: string) => path === folderPath || path.startsWith(prefix);
  const removedFiles = workspace.files
    .filter((entry) => underFolder(entry.relativePath))
    .map((entry) => entry.relativePath);

  // Close each removed file's tab first (carries openFilePaths + the active-file
  // fallback), then drop its buffer and any chat-context reference.
  const next = removedFiles.reduce((ws, path) => closeWorkspaceFileTab(ws, path), workspace);
  const fileContents = { ...next.fileContents };
  for (const path of removedFiles) {
    delete fileContents[path];
  }
  const chatThread = removedFiles.reduce(
    (thread, path) => removeFileContext(thread, path),
    next.chatThread,
  );

  return {
    ...next,
    files: next.files.filter((entry) => !underFolder(entry.relativePath)),
    folders: next.folders.filter((path) => !underFolder(path)),
    fileContents,
    chatThread,
    comments: next.comments.filter((comment) => !underFolder(comment.filePath)),
  };
}

/** User-initiated deletion: close the tab and drop the buffer, and — unlike an
 * external removal (mark-not-remove) — also clear the file's chat context
 * and comments: the user chose to remove the note. */
export function removeDeletedFile(workspace: Workspace, filePath: string): Workspace {
  const withoutTab = closeWorkspaceFileTab(workspace, filePath);
  return {
    ...withoutTab,
    chatThread: removeFileContext(withoutTab.chatThread, filePath),
    comments: withoutTab.comments.filter((comment) => comment.filePath !== filePath),
    files: withoutTab.files.filter((entry) => entry.relativePath !== filePath),
  };
}

/**
 * Paint the tree from the last scan's inventory while the real one runs.
 *
 * Deliberately not {@link applyScanResult}: that reports the list as
 * authoritative (`scanState: "ready"`), and this one is not — it is what was
 * true when the workspace was last scanned. The state stays `loading` so the
 * walk still owns the answer, and only the empty tree is avoided.
 *
 * A workspace that already has files keeps them: a snapshot arriving after a
 * real scan would be a step backwards in freshness.
 */
export function applyFileSnapshot(
  workspace: Workspace,
  entries: WorkspaceFileEntry[],
): Workspace {
  if (entries.length === 0 || workspace.files.length > 0) {
    return workspace;
  }
  return {
    ...workspace,
    files: [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
  };
}

/** Registry records → tree entries. mtime/size are placeholders — the sidebar
 *  shows names only, and buffers stat on read. */
export function looseEntries(files: { path: string }[]): WorkspaceFileEntry[] {
  return files.map((record) => ({
    relativePath: record.path,
    lastModifiedMs: 0,
    sizeBytes: 0,
  }));
}

/** The external-files registry laid onto the loose pseudo-workspace: its tree,
 *  its open tabs, and which of them is showing. Tabs whose file left the
 *  registry are dropped rather than left pointing at nothing. */
export function applyExternalFiles(
  workspace: Workspace,
  list: ExternalFilesList,
): Workspace {
  const files = looseEntries(list.files);
  const known = new Set(files.map((entry) => entry.relativePath));
  const openFilePaths = list.openPaths.filter((path) => known.has(path));
  return {
    ...workspace,
    activeFilePath: openFilePaths.includes(list.activePath) ? list.activePath : "",
    files,
    openFilePaths,
  };
}

export function applyScanResult(
  workspace: Workspace,
  entries: WorkspaceFileEntry[],
): Workspace {
  // A scan refreshes the file LIST only. It deliberately does NOT prune open
  // tabs, their buffers, comments, or the active file when a path is missing
  // from `entries`: a partial or racing scan would otherwise wipe the user's
  // open work (and the empty-tabs fallback would then swap in Welcome.md). A
  // genuine deletion closes its tab via the `removed` fs-event (applyFsEvent);
  // a tab whose file is truly gone just errors gracefully when opened.
  return {
    ...workspace,
    files: [...entries].sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
    scanError: null,
    scanState: "ready",
  };
}

export function applyFileBuffer(
  workspace: Workspace,
  relativePath: string,
  buffer: { content: string; lastModifiedMs: number },
): Workspace {
  return {
    ...workspace,
    fileContents: {
      ...workspace.fileContents,
      [relativePath]: {
        conflict: false,
        content: buffer.content,
        dirty: false,
        lastModifiedMs: buffer.lastModifiedMs,
        pendingChanges: [],
      },
    },
  };
}

/** A freshly-read buffer, unless the one in hand has unsaved edits. The launch
 *  now paints the open document before the read that confirms it lands, so the
 *  first keystrokes after a launch must not be overwritten by the read they
 *  raced. */
export function applyUneditedFileBuffer(
  workspace: Workspace,
  relativePath: string,
  buffer: { content: string; lastModifiedMs: number },
): Workspace {
  return workspace.fileContents[relativePath]?.dirty
    ? workspace
    : applyFileBuffer(workspace, relativePath, buffer);
}

export function markBufferDirty(
  workspace: Workspace,
  relativePath: string,
  content: string,
  changes: DocumentTextChange[] = [],
): Workspace {
  const existing = workspace.fileContents[relativePath];
  if (!existing) {
    return workspace;
  }
  const pendingChanges =
    changes.length > 0 ? [...existing.pendingChanges, ...changes] : existing.pendingChanges;
  if (
    existing.content === content &&
    existing.dirty &&
    pendingChanges === existing.pendingChanges
  ) {
    return workspace;
  }
  return {
    ...workspace,
    fileContents: {
      ...workspace.fileContents,
      [relativePath]: { ...existing, content, dirty: true, pendingChanges },
    },
  };
}

export function markBufferSaved(
  workspace: Workspace,
  relativePath: string,
  lastModifiedMs: number,
): Workspace {
  const existing = workspace.fileContents[relativePath];
  if (!existing) {
    return workspace;
  }
  const files = workspace.files.map((entry) =>
    entry.relativePath === relativePath
      ? { ...entry, lastModifiedMs, sizeBytes: existing.content.length }
      : entry,
  );
  return {
    ...workspace,
    files,
    fileContents: {
      ...workspace.fileContents,
      [relativePath]: {
        ...existing,
        conflict: false,
        dirty: false,
        lastModifiedMs,
        pendingChanges: [],
      },
    },
    lastSavedAt: new Date(),
  };
}

export function markBufferConflict(
  workspace: Workspace,
  relativePath: string,
): Workspace {
  const existing = workspace.fileContents[relativePath];
  if (!existing) {
    return workspace;
  }
  return {
    ...workspace,
    fileContents: {
      ...workspace.fileContents,
      [relativePath]: { ...existing, conflict: true },
    },
  };
}

export function dismissBufferConflict(
  workspace: Workspace,
  relativePath: string,
): Workspace {
  const existing = workspace.fileContents[relativePath];
  if (!existing) {
    return workspace;
  }
  return {
    ...workspace,
    fileContents: {
      ...workspace.fileContents,
      [relativePath]: { ...existing, conflict: false },
    },
  };
}
