import { useCallback } from "react";

import { useWorkspaceStore } from "../../app/workspaceStore";
import { useConfirm } from "../dialogs/ConfirmProvider";
import { useTextPrompt } from "../dialogs/TextPromptProvider";

interface TreeActionsInput {
  readonly workspaceRoot: string;
  readonly toggleFolder: (path: string) => void;
  readonly onSelectFile: (relativePath: string) => void;
}

/**
 * What the tree's rows and their right-click menu do: copy a note's path,
 * show it in Finder, make a note or folder in a folder, delete a folder, and
 * keep the folder a plain "New note" lands in following the selection. Each
 * is stable, so the memoised rows do not re-render because of them.
 */
export function useTreeActions({ workspaceRoot, toggleFolder, onSelectFile }: TreeActionsInput) {
  const promptText = useTextPrompt();
  const setNewNoteDir = useWorkspaceStore((state) => state.setNewNoteDir);
  const createNote = useWorkspaceStore((state) => state.createNote);
  const createFolder = useWorkspaceStore((state) => state.createFolder);
  const deleteFolder = useWorkspaceStore((state) => state.deleteFolder);
  const confirm = useConfirm();

  // File-row actions needing the absolute path (workspace root + relative path).
  const absPath = useCallback(
    (relativePath: string) =>
      workspaceRoot ? `${workspaceRoot.replace(/\/+$/, "")}/${relativePath}` : relativePath,
    [workspaceRoot],
  );
  const copyPath = useCallback(
    (relativePath: string) => void navigator.clipboard?.writeText(absPath(relativePath)),
    [absPath],
  );
  const revealInFinder = useCallback(
    (relativePath: string) => {
      void import("@tauri-apps/plugin-opener")
        .then(({ revealItemInDir }) => revealItemInDir(absPath(relativePath)))
        .catch(() => {});
    },
    [absPath],
  );

  // Clicking a folder both toggles it and marks it as the new-note target;
  // clicking a file targets its parent folder — so the highlighted target
  // always tracks where the user is, and gives a way back to the root (open a
  // root-level note). Stable so the memoised rows don't churn.
  const activateFolder = useCallback(
    (path: string) => {
      toggleFolder(path);
      setNewNoteDir(path);
    },
    [toggleFolder, setNewNoteDir],
  );
  const newNoteHere = useCallback(
    (path: string) => {
      setNewNoteDir(path);
      void createNote({ dir: path });
    },
    [setNewNoteDir, createNote],
  );
  // "New folder here" creates a real empty directory. `path === ""` makes a
  // top-level folder.
  const newFolderHere = useCallback(
    (path: string) => {
      void (async () => {
        const name = await promptText({
          title: "New folder",
          label: "Folder name",
          submitLabel: "Create",
        });
        const trimmed = name?.trim();
        if (!trimmed) {
          return;
        }
        const dir = path ? `${path}/${trimmed}` : trimmed;
        await createFolder(dir);
      })();
    },
    [promptText, createFolder],
  );
  const handleDeleteFolder = useCallback(
    (path: string) => {
      void (async () => {
        const state = useWorkspaceStore.getState();
        const ws = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
        const count = ws
          ? ws.files.filter(
              (entry) => entry.relativePath === path || entry.relativePath.startsWith(`${path}/`),
            ).length
          : 0;
        const confirmed = await confirm({
          title: "Delete folder",
          message:
            count > 0
              ? `Delete "${path}" and its ${count} note${count === 1 ? "" : "s"}? They move to trash.`
              : `Delete the empty folder "${path}"?`,
          confirmLabel: "Delete",
          danger: true,
        });
        if (confirmed) {
          await deleteFolder(path);
        }
      })();
    },
    [confirm, deleteFolder],
  );
  const selectFileTrackingDir = useCallback(
    (relativePath: string) => {
      onSelectFile(relativePath);
      const slash = relativePath.lastIndexOf("/");
      setNewNoteDir(slash >= 0 ? relativePath.slice(0, slash) : "");
    },
    [onSelectFile, setNewNoteDir],
  );

  return { copyPath, revealInFinder, activateFolder, newNoteHere, newFolderHere, handleDeleteFolder, selectFileTrackingDir };
}
