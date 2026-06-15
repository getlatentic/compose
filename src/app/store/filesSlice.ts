import type { WorkspaceState, WorkspaceStoreGet, WorkspaceStoreSet } from "./types";
import { showErrorToast } from "../../features/toast/toastStore";
import {
  FileConflictError,
  createFile as createFileIpc,
  deleteFile as deleteFileIpc,
  readFile as readFileIpc,
  renameFile as renameFileIpc,
  writeFile as writeFileIpc,
} from "../../lib/ipc/filesClient";
import {
  applyFileBuffer,
  applyWorkspaceDocumentChanges,
  closeWorkspaceFileTab,
  dismissBufferConflict,
  markBufferConflict,
  markBufferSaved,
  moveWorkspaceComments,
  openWorkspaceFile,
  setCurrentTabContext,
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
  pushNavEntry,
} from "./navigation";

export const createFilesSlice = (
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
): Pick<WorkspaceState, "activeFileBuffer" | "activeFileEntry" | "selectFile" | "closeFileTab" | "createNote" | "deleteActiveFile" | "renameActiveFile" | "reloadActiveFile" | "saveActiveFile" | "updateActiveContent" | "dismissConflict"> => ({
  activeFileBuffer: () => {
    const workspace = get().activeWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return null;
    }
    return workspace.fileContents[workspace.activeFilePath] ?? null;
  },
  activeFileEntry: () => {
    const workspace = get().activeWorkspace();
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

    // Persist the OUTGOING file before switching, so a quick tab switch
    // (before the ~1s autosave fires) never strands its edits off-disk —
    // the only data-loss window a crash could otherwise hit. `saveActiveFile`
    // flushes the live editor + captures the current file path synchronously
    // before its first await, so firing it un-awaited here saves the
    // outgoing file in the background without slowing the switch.
    if (path !== workspace.activeFilePath) {
      const outgoing = workspace.activeFilePath
        ? workspace.fileContents[workspace.activeFilePath]
        : null;
      if (outgoing?.dirty) {
        void get().saveActiveFile();
      }
    }

    set((state) => {
      const updated = updateWorkspace(state.workspaces, workspace.id, (item) =>
        openWorkspaceFile(item, path),
      );
      const navPatch = pushNavEntry(state, {
        kind: "file",
        id: path,
        workspaceId: workspace.id,
      });
      return navPatch ? { workspaces: updated, ...navPatch } : { workspaces: updated };
    });
    persistTabs(get().workspaces, workspace.id);

    const current = get().workspaces.find((item) => item.id === workspace.id);
    if (current && current.fileContents[path]) {
      return;
    }

    try {
      const buffer = await readFileIpc(workspace.id, path);
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) =>
          applyFileBuffer(item, path, buffer),
        ),
      }));
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : "Could not open file");
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
  createNote: async () => {
    const workspace = get().activeWorkspace();
    if (!workspace) {
      return;
    }

    const relativePath = nextUntitledPath(workspace);
    const content = `# Untitled\n\n`;

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
  deleteActiveFile: async () => {
    const workspace = get().activeWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return;
    }
    const filePath = workspace.activeFilePath;

    try {
      await deleteFileIpc(workspace.id, filePath);
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspace.id, (item) => {
          const withoutTab = closeWorkspaceFileTab(item, filePath);
          return {
            ...withoutTab,
            comments: withoutTab.comments.filter((comment) => comment.filePath !== filePath),
            files: withoutTab.files.filter((entry) => entry.relativePath !== filePath),
          };
        }),
      }));
      persistTabs(get().workspaces, workspace.id);
      persistComments(get().workspaces, workspace.id, showErrorToast);
      void get().rebuildWorkspaceIndex(workspace.id);
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : "Could not delete file");
    }
  },
  renameActiveFile: async (toRelativePath: string) => {
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
            chatThread: setCurrentTabContext(item.chatThread, item.id, activeFilePath),
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
    const workspace = get().activeWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return;
    }
    const filePath = workspace.activeFilePath;
    try {
      const buffer = await readFileIpc(workspace.id, filePath);
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
  saveActiveFile: async () => {
    // Pull the editor's live content into the buffer FIRST. The editor's
    // buffer update is debounced 500ms, so without this a Cmd+S (or
    // autosave) within that window would persist stale text — confirmed
    // data-loss bug. `flushActiveEditor` runs the editor's flush
    // synchronously (Zustand set), so the buffer read below is current.
    flushActiveEditor();
    const workspace = get().activeWorkspace();
    if (!workspace || !workspace.activeFilePath) {
      return;
    }
    const filePath = workspace.activeFilePath;
    const buffer = workspace.fileContents[filePath];
    if (!buffer) {
      return;
    }

    try {
      const result = await writeFileIpc(
        workspace.id,
        filePath,
        buffer.content,
        buffer.conflict ? null : buffer.lastModifiedMs,
        buffer.pendingChanges,
      );
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
  updateActiveContent: (markdown: string, changes: DocumentTextChange[] = []) => {
    const workspace = get().activeWorkspace();
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
    const workspace = get().activeWorkspace();
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
