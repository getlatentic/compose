import type { WorkspaceState, WorkspaceStoreGet, WorkspaceStoreSet } from "./types";
import { showErrorToast } from "../../features/toast/toastStore";
import {
  FileConflictError,
  FileNotFoundError,
  createFile as createFileIpc,
  createFolder as createFolderIpc,
  deleteFile as deleteFileIpc,
  deleteFolder as deleteFolderIpc,
  readFile as readFileIpc,
  renameFile as renameFileIpc,
  writeFile as writeFileIpc,
} from "../../lib/ipc/filesClient";
import {
  externalReadFile,
  externalWriteFile,
} from "../../lib/ipc/externalFilesClient";
import type { Workspace, WorkspaceFileBuffer } from "../workspaceModel";
import {
  applyFileBuffer,
  removeDeletedFile,
  applyWorkspaceDocumentChanges,
  closeWorkspaceFileTab,
  dismissBufferConflict,
  markBufferConflict,
  markBufferSaved,
  moveWorkspaceComments,
  openWorkspaceFile,
  removeWorkspaceFolder,
  renameContextItemPath,
  reorderOpenTabs,
  type DocumentTextChange,
  type WorkspaceFileEntry,
} from "../workspaceModel";
import {
  flushActiveEditor,
} from "../../lib/editor/editorFlush";
import {
  nextUntitledPath,
  updateWorkspace,
} from "./internals";
import {
  persistComments,
  persistTabs,
} from "./persistence";
import {
  pruneNavHistory,
  pushNavEntry,
} from "./navigation";

/** Files whose buffer is being read, keyed `${workspaceId}\n${path}`, so the
 *  editor's load-if-missing effect never races `selectFile` into a duplicate
 *  read of the same file. */
const loadingBuffers = new Set<string>();

/** Read a file's content, routed by its container: external files (the loose
 *  workspace) read by absolute path; workspace files by `(id, relative)`. */
function readFileFor(workspace: Workspace, path: string) {
  return workspace.kind === "loose" ? externalReadFile(path) : readFileIpc(workspace.id, path);
}

/** Write a buffer, routed the same way. External writes carry the same
 *  conflict expectation; comment position changes are workspace-only. */
export function writeBufferFor(workspace: Workspace, path: string, buffer: WorkspaceFileBuffer) {
  const expected = buffer.conflict ? null : buffer.lastModifiedMs;
  return workspace.kind === "loose"
    ? externalWriteFile(path, buffer.content, expected)
    : writeFileIpc(workspace.id, path, buffer.content, expected, buffer.pendingChanges);
}

/** Save the outgoing focused file before the editor swaps documents — the
 *  no-data-loss dance of #43 (flush the 500ms editor debounce, then write if
 *  dirty), shared by workspace and loose selects so the two switch paths can
 *  never drift. `saveActiveFile` captures the focused path synchronously
 *  before its first await, so firing it un-awaited saves the outgoing file in
 *  the background without slowing the switch. */
export function commitOutgoingFile(get: WorkspaceStoreGet, next: { id: string; path: string }) {
  const outgoing = get().focusedWorkspace();
  if (!outgoing?.activeFilePath) {
    return;
  }
  if (outgoing.id === next.id && outgoing.activeFilePath === next.path) {
    return;
  }
  flushActiveEditor();
  if (get().focusedWorkspace()?.fileContents[outgoing.activeFilePath]?.dirty) {
    void get().saveActiveFile();
  }
}

/** After a loose tab closes: if the loose area lost its active file while
 *  focused, hand the editor back to the workspace. */
export function settleLooseFocus(set: WorkspaceStoreSet, get: WorkspaceStoreGet) {
  if (
    get().focusedArea === "loose" &&
    !get().workspaces.find((item) => item.kind === "loose")?.activeFilePath
  ) {
    set({ focusedArea: "workspace" });
  }
}

/** The single buffer loader: read a file's content into its buffer if it isn't
 *  loaded yet. `selectFile` uses it on a tab click; an editor effect uses it for
 *  every other path that points `activeFilePath` at an unread file — closing or
 *  deleting a tab, restoring tabs on open — which used to strand the editor on
 *  "Loading file…" because only `selectFile` ever read (#50). */
export async function loadBufferIfMissing(
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
  workspaceId: string,
  path: string,
): Promise<void> {
  if (!path) {
    return;
  }
  const workspace = get().workspaces.find((item) => item.id === workspaceId);
  if (!workspace || workspace.fileContents[path]) {
    return;
  }
  const key = `${workspaceId}\n${path}`;
  if (loadingBuffers.has(key)) {
    return;
  }
  loadingBuffers.add(key);
  try {
    const buffer = await readFileFor(workspace, path);
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspaceId, (item) =>
        applyFileBuffer(item, path, buffer),
      ),
    }));
  } catch (error) {
    // A tab whose file is GONE (deleted externally, stale restored tab) must
    // not strand on a forever-blank editor: when the file list agrees the file
    // no longer exists — or the read itself says NotFound, which is
    // authoritative — close the tab; otherwise (transient read hiccup) keep it
    // and surface the error (#105). The workspace list is only trustworthy
    // once its scan has SETTLED: an OS-open racing the boot scan of a large
    // vault must not get its tab silently closed by a still-empty list. The
    // loose list is the registry itself, current by construction.
    const current = get().workspaces.find((item) => item.id === workspaceId);
    const stillListed = current?.files.some((entry) => entry.relativePath === path) ?? false;
    const listSettled = current?.kind === "loose" || current?.scanState === "ready";
    if (!stillListed && (listSettled || error instanceof FileNotFoundError)) {
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspaceId, (item) =>
          closeWorkspaceFileTab(item, path),
        ),
      }));
      settleLooseFocus(set, get);
      persistTabs(get().workspaces, workspaceId);
      return;
    }
    showErrorToast(error instanceof Error ? error.message : "Could not open file");
  } finally {
    loadingBuffers.delete(key);
  }
}

export const createFilesSlice = (
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
): Pick<WorkspaceState, "activeFileBuffer" | "activeFileEntry" | "selectFile" | "ensureActiveBuffer" | "closeFileTab" | "reorderTab" | "createNote" | "createFolder" | "deleteFolder" | "newNoteDir" | "setNewNoteDir" | "deleteActiveFile" | "deleteFile" | "renameActiveFile" | "reloadActiveFile" | "saveActiveFile" | "saveAllDirtyBuffers" | "updateActiveContent" | "dismissConflict"> => ({
  activeFileBuffer: () => {
    const workspace = get().focusedWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return null;
    }
    return workspace.fileContents[workspace.activeFilePath] ?? null;
  },
  activeFileEntry: () => {
    const workspace = get().focusedWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return null;
    }
    return (
      workspace.files.find((entry) => entry.relativePath === workspace.activeFilePath) ?? null
    );
  },
  selectFile: async (path: string) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }

    // Persist the OUTGOING file — whatever the editor shows, possibly an
    // external one — before switching, so a quick tab switch (before the ~1s
    // autosave fires) never strands its edits off-disk (#43).
    commitOutgoingFile(get, { id: workspace.id, path });

    set((state) => {
      const updated = updateWorkspace(state.workspaces, workspace.id, (item) =>
        openWorkspaceFile(item, path),
      );
      const navPatch = pushNavEntry(state, {
        kind: "file",
        id: path,
        workspaceId: workspace.id,
      });
      return {
        workspaces: updated,
        focusedArea: "workspace" as const,
        ...(navPatch ?? {}),
      };
    });
    persistTabs(get().workspaces, workspace.id);

    await loadBufferIfMissing(set, get, workspace.id, path);
  },
  ensureActiveBuffer: async () => {
    const workspace = get().focusedWorkspace();
    if (workspace?.activeFilePath) {
      await loadBufferIfMissing(set, get, workspace.id, workspace.activeFilePath);
    }
  },
  closeFileTab: (filePath: string) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }

    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
        closeWorkspaceFileTab(item, filePath),
      ),
    }));
    persistTabs(get().workspaces, workspace.id);
  },
  reorderTab: (fromPath, toPath) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => ({
        ...item,
        openFilePaths: reorderOpenTabs(item.openFilePaths, fromPath, toPath),
      })),
    }));
    persistTabs(get().workspaces, workspace.id);
  },
  newNoteDir: "",
  setNewNoteDir: (dir) => set({ newNoteDir: dir }),
  createNote: async (seed) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }

    // A seed (the empty view's first "New note") writes the welcome note; the
    // plain `+` falls back to a blank untitled note — in the chosen folder
    // (`newNoteDir`, set by selecting a folder/file in the tree) or the root.
    const dir = seed?.dir ?? get().newNoteDir;
    const relativePath = seed?.relativePath ?? nextUntitledPath(workspace, dir);
    const content = seed?.content ?? `# Untitled\n\n`;

    try {
      const result = await createFileIpc(workspace.id, relativePath, content);
      const newEntry: WorkspaceFileEntry = {
        lastModifiedMs: result.lastModifiedMs,
        relativePath,
        sizeBytes: content.length,
      };
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => {
          const filesWithNew = item.files.some((entry) => entry.relativePath === relativePath)
            ? item.files
            : [...item.files, newEntry].sort((a, b) =>
                a.relativePath.localeCompare(b.relativePath),
              );
          const withBuffer = applyFileBuffer(item, relativePath, {
            content,
            lastModifiedMs: result.lastModifiedMs,
          });
          return openWorkspaceFile({ ...withBuffer, files: filesWithNew }, relativePath);
        }),
      }));
      persistTabs(get().workspaces, workspace.id);
      void get().rebuildWorkspaceIndex(workspace.id);
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : "Could not create note");
    }
  },
  createFolder: async (relativePath) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    try {
      await createFolderIpc(workspace.id, relativePath);
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
          item.folders.includes(relativePath)
            ? item
            : {
                ...item,
                folders: [...item.folders, relativePath].sort((a, b) => a.localeCompare(b)),
              },
        ),
      }));
      // New notes now default into the folder just created.
      get().setNewNoteDir(relativePath);
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : "Could not create folder");
    }
  },
  deleteFolder: async (folderPath) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }
    try {
      await deleteFolderIpc(workspace.id, folderPath);
      const prefix = `${folderPath}/`;
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
          removeWorkspaceFolder(item, folderPath),
        ),
        // Prune the folder's files from nav history so Back/Forward can't
        // resurrect them (#45).
        ...pruneNavHistory(
          state,
          (entry) =>
            !(
              entry.kind === "file" &&
              entry.workspaceId === workspace.id &&
              (entry.id === folderPath || entry.id.startsWith(prefix))
            ),
        ),
      }));
      persistTabs(get().workspaces, workspace.id);
      persistComments(get().workspaces, workspace.id, showErrorToast);
      void get().rebuildWorkspaceIndex(workspace.id);
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : "Could not delete folder");
    }
  },
  deleteActiveFile: async () => {
    // Deleting an external file would trash a document OUTSIDE the workspace;
    // the sidebar's remove control (stop tracking) is the affordance instead.
    if (get().focusedArea === "loose") {
      showErrorToast("External files can't be deleted from Compose — remove them from the list instead.");
      return;
    }
    const filePath = get().activeWorkspace()?.activeFilePath;
    if (filePath) {
      await get().deleteFile(filePath);
    }
  },
  deleteFile: async (relativePath: string) => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }

    // Persist any unsaved edits first, so the trashed copy — and the history
    // snapshot the backend takes on soft-delete — hold the user's latest work
    // (#44). The active file's buffer lags the editor by the 500ms debounce, so
    // flush it; a background tab's buffer is already current. Best-effort: a
    // write failure must not block the deletion the user asked for.
    if (workspace.activeFilePath === relativePath) {
      flushActiveEditor();
    }
    const buffer = get().activeWorkspace()?.fileContents[relativePath];
    if (buffer?.dirty) {
      try {
        await writeFileIpc(
          workspace.id,
          relativePath,
          buffer.content,
          buffer.conflict ? null : buffer.lastModifiedMs,
          buffer.pendingChanges,
        );
      } catch {
        // The soft-delete still snapshots the on-disk content to history.
      }
    }

    try {
      await deleteFileIpc(workspace.id, relativePath);
      set((state) => ({
        // Deleting a BACKGROUND file never steals focus: the tab (if any)
        // closes in place and the active tab stays put (#105).
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
          removeDeletedFile(item, relativePath),
        ),
        // Drop the deleted file from nav history so Back/Forward can't
        // resurrect it as a dangling error tab (#45).
        ...pruneNavHistory(
          state,
          (entry) =>
            !(
              entry.kind === "file" &&
              entry.workspaceId === workspace.id &&
              entry.id === relativePath
            ),
        ),
      }));
      persistTabs(get().workspaces, workspace.id);
      persistComments(get().workspaces, workspace.id, showErrorToast);
      void get().rebuildWorkspaceIndex(workspace.id);
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : "Could not delete file");
    }
  },
  renameActiveFile: async (toRelativePath: string) => {
    // External files are other apps' documents at their own paths — renaming
    // them belongs to Finder, not Compose (#113 v1).
    if (get().focusedArea === "loose") {
      showErrorToast("External files can't be renamed from Compose.");
      return;
    }
    const workspace = get().activeWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return;
    }
    const from = workspace.activeFilePath;
    const trimmed = toRelativePath.trim();
    if (!trimmed || trimmed === from) {
      return;
    }

    try {
      await renameFileIpc(workspace.id, from, trimmed);
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => {
          const buffer = item.fileContents[from];
          const remainingContents = { ...item.fileContents };
          delete remainingContents[from];
          if (buffer) {
            remainingContents[trimmed] = buffer;
          }
          const files = item.files
            .map((entry) =>
              entry.relativePath === from ? { ...entry, relativePath: trimmed } : entry,
            )
            .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
          const openFilePaths = item.openFilePaths.map((path) =>
            path === from ? trimmed : path,
          );
          const activeFilePath = item.activeFilePath === from ? trimmed : item.activeFilePath;
          const renamed = {
            ...item,
            activeFilePath,
            chatThread: renameContextItemPath(item.chatThread, item.id, from, trimmed),
            fileContents: remainingContents,
            files,
            openFilePaths,
          };
          return moveWorkspaceComments(renamed, from, trimmed, Date.now());
        }),
      }));
      persistTabs(get().workspaces, workspace.id);
      persistComments(get().workspaces, workspace.id, showErrorToast);
      void get().rebuildWorkspaceIndex(workspace.id);
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : "Could not rename file");
    }
  },
  reloadActiveFile: async () => {
    const workspace = get().focusedWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return;
    }
    const filePath = workspace.activeFilePath;
    try {
      const buffer = await readFileFor(workspace, filePath);
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
          applyFileBuffer(item, filePath, buffer),
        ),
      }));
      void get().rebuildWorkspaceIndex(workspace.id);
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : "Could not reload file");
    }
  },
  saveActiveFile: async (options?: { implicit?: boolean }) => {
    // Pull the editor's live content into the buffer FIRST. The editor's
    // buffer update is debounced 500ms, so without this a Cmd+S (or
    // autosave) within that window would persist stale text — confirmed
    // data-loss bug. `flushActiveEditor` runs the editor's flush
    // synchronously (Zustand set), so the buffer read below is current.
    flushActiveEditor();
    const workspace = get().focusedWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return;
    }
    const filePath = workspace.activeFilePath;
    const buffer = workspace.fileContents[filePath];
    if (!buffer) {
      return;
    }
    // An IMPLICIT save (autosave, quit flush) must never re-create a file that
    // was deleted under the tab — that resurrection made deletes look like
    // no-ops (#105). An explicit Cmd+S on a kept dirty tab still writes: that
    // is the user deliberately bringing the note back. For external files the
    // list entry plays the same role: removing one stops its implicit saves.
    if (
      options?.implicit &&
      !workspace.files.some((entry) => entry.relativePath === filePath)
    ) {
      return;
    }

    try {
      const result = await writeBufferFor(workspace, filePath, buffer);
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
          markBufferSaved(item, filePath, result.lastModifiedMs),
        ),
      }));
      void get().rebuildWorkspaceIndex(workspace.id);
    } catch (error) {
      if (error instanceof FileConflictError) {
        showErrorToast("File changed on disk — reload before saving.");
        set((state) => ({
          workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
            markBufferConflict(item, filePath),
          ),
        }));
        return;
      }
      showErrorToast(error instanceof Error ? error.message : "Save failed");
    }
  },
  saveAllDirtyBuffers: async () => {
    // Flush the active editor (its buffer write is 500ms debounced), then write
    // EVERY dirty buffer across all workspaces — including background tabs that
    // never autosave on their own, and external files in the loose workspace.
    // This is the flush-on-quit so closing the app doesn't drop unsaved edits
    // (#43). Best-effort per file: one failure (e.g. a disk conflict) must not
    // block the others or trap the user's quit.
    flushActiveEditor();
    const writes: Promise<unknown>[] = [];
    for (const workspace of get().workspaces) {
      for (const [filePath, buffer] of Object.entries(workspace.fileContents)) {
        if (!buffer.dirty || buffer.conflict) {
          continue;
        }
        // Quit-flush is an implicit save: a buffer whose file was deleted
        // (externally or by us) must not resurrect it on exit (#105).
        if (!workspace.files.some((entry) => entry.relativePath === filePath)) {
          continue;
        }
        writes.push(
          writeBufferFor(workspace, filePath, buffer)
            .then((result) => {
              set((state) => ({
                workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
                  markBufferSaved(item, filePath, result.lastModifiedMs),
                ),
              }));
            })
            .catch(() => {}),
        );
      }
    }
    await Promise.all(writes);
  },
  updateActiveContent: (markdown: string, changes: DocumentTextChange[] = []) => {
    const workspace = get().focusedWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return;
    }

    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
        applyWorkspaceDocumentChanges(
          item,
          item.activeFilePath,
          markdown,
          changes,
          Date.now(),
        ),
      ),
    }));
    if (changes.length > 0) {
      persistComments(get().workspaces, workspace.id, showErrorToast);
    }
  },
  dismissConflict: (relativePath: string) => {
    const workspace = get().focusedWorkspace();
    if (!workspace) {
      return;
    }
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
        dismissBufferConflict(item, relativePath),
      ),
    }));
  },
});
