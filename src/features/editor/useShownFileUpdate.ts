import { useCallback, useEffect, useRef } from "react";

import { useWorkspaceStore } from "../../app/workspaceStore";
import type { DocumentTextChange } from "../comments/commentModel";

/**
 * The editor's `onChange`, bound to the file the editor is showing.
 *
 * On a switch the editor first hands over the last edits of the file it is
 * leaving, and by then the store's active file is the new one: an update
 * addressed to "the active file" would write one note's text into another.
 * The effect here runs after the editor's own (a child's effects run first),
 * so the hand-over still finds the file it left.
 */
export function useShownFileUpdate(
  workspaceId: string,
  path: string,
): (markdown: string, changes?: DocumentTextChange[]) => void {
  const updateFileContent = useWorkspaceStore((state) => state.updateFileContent);
  const shown = useRef({ workspaceId, path });
  useEffect(() => {
    shown.current = { workspaceId, path };
  }, [workspaceId, path]);
  return useCallback(
    (markdown, changes = []) =>
      updateFileContent(shown.current.workspaceId, shown.current.path, markdown, changes),
    [updateFileContent],
  );
}
