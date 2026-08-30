import { useCallback } from "react";

import { useWorkspaceStore } from "../../app/workspaceStore";
import { useTextPrompt } from "../dialogs/TextPromptProvider";

export interface NewItemActions {
  newNote: () => void;
  newFolder: () => void;
}

/**
 * Creating a note or a folder, shared by the sidebar's "+ New" menu and the
 * File menu's ⌘N / ⌘⇧N.
 *
 * One home for both, because the folder case is not a one-liner — it prompts
 * for a name and resolves the destination — and two copies of that would drift.
 */
export function useNewItemActions(): NewItemActions {
  const createNote = useWorkspaceStore((state) => state.createNote);
  const createFolder = useWorkspaceStore((state) => state.createFolder);
  const newNoteDir = useWorkspaceStore((state) => state.newNoteDir);
  const promptText = useTextPrompt();

  const newNote = useCallback(() => void createNote(), [createNote]);

  // Lands in the selected folder (`newNoteDir`) or the root, so the first
  // top-level folder can be made in an empty workspace — the tree's own "New
  // folder here" needs an existing folder row to hang off (#56).
  const newFolder = useCallback(() => {
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
      await createFolder(newNoteDir ? `${newNoteDir}/${trimmed}` : trimmed);
    })();
  }, [promptText, createFolder, newNoteDir]);

  return { newNote, newFolder };
}
