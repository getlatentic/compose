import type { Workspace, WorkspaceFileEntry } from "./types";

/**
 * A workspace's open tabs.
 */

/** Move an open tab to sit just before another, preserving the rest of the
 * order — drag-to-reorder. The active file is untouched. */
export function reorderOpenTabs(
  openFilePaths: string[],
  fromPath: string,
  toPath: string,
): string[] {
  if (
    fromPath === toPath ||
    !openFilePaths.includes(fromPath) ||
    !openFilePaths.includes(toPath)
  ) {
    return openFilePaths;
  }
  const without = openFilePaths.filter((path) => path !== fromPath);
  without.splice(without.indexOf(toPath), 0, fromPath);
  return without;
}

export function openWorkspaceFile(workspace: Workspace, filePath: string): Workspace {
  const openFilePaths = workspace.openFilePaths.includes(filePath)
    ? workspace.openFilePaths
    : [...workspace.openFilePaths, filePath];

  // Opening / switching to a tab is navigation only — it must NOT repoint the
  // chat context, which the user controls explicitly. The context defaults
  // to the active file at load and on a new chat, then stays pinned.
  return {
    ...workspace,
    activeFilePath: filePath,
    openFilePaths,
  };
}

export function closeWorkspaceFileTab(workspace: Workspace, filePath: string): Workspace {
  const closingIndex = workspace.openFilePaths.indexOf(filePath);
  if (closingIndex === -1) {
    return workspace;
  }

  const openFilePaths = workspace.openFilePaths.filter((path) => path !== filePath);
  const activeFilePath =
    workspace.activeFilePath === filePath
      ? openFilePaths[Math.min(closingIndex, openFilePaths.length - 1)] ?? ""
      : workspace.activeFilePath;

  const remainingFileContents = { ...workspace.fileContents };
  delete remainingFileContents[filePath];

  // Closing a tab is navigation too — leave the chat context as the user set it
  //. A still-existing file can stay in context even with no tab open; a
  // deleted file is removed from context by deleteActiveFile.
  return {
    ...workspace,
    activeFilePath,
    fileContents: remainingFileContents,
    openFilePaths,
  };
}

/**
 * The file entries to render as open tabs — one per `openFilePaths`, in order.
 * An open path's real scan entry is used when present; when it's transiently
 * absent from `files` (a partial / racing scan on a large vault) a minimal
 * entry is synthesized from the path so the tab keeps rendering. A tab only
 * closes on a confirmed `removed` fs-event (see applyFsEvent) — never because a
 * scan momentarily omitted its file. The synthesized entry's size/mtime are
 * placeholders; PaneTabs reads only `relativePath`, and the dirty dot reads the
 * buffer, so they're never shown.
 */
export function resolveOpenTabs(workspace: Workspace): WorkspaceFileEntry[] {
  return workspace.openFilePaths.map(
    (filePath) =>
      workspace.files.find((entry) => entry.relativePath === filePath) ?? {
        relativePath: filePath,
        lastModifiedMs: 0,
        sizeBytes: 0,
      },
  );
}

/**
 * Whether the active file should render its document (vs the empty/Welcome
 * state). True when the active path is an open tab, has a loaded buffer, or is
 * in the scanned list — so a transient scan miss can't blank an open document.
 * The buffer/open-tab cases hold the document open while a (re)scan is missing
 * the file; only closing the tab (a confirmed deletion or the user's ✕) flips
 * this to false.
 */
export function isActiveFilePresent(workspace: Workspace): boolean {
  const path = workspace.activeFilePath;
  if (!path) {
    return false;
  }
  return (
    workspace.openFilePaths.includes(path) ||
    Boolean(workspace.fileContents[path]) ||
    workspace.files.some((entry) => entry.relativePath === path)
  );
}
