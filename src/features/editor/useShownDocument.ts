import { useMemo } from "react";

import { selectFocusedWorkspace } from "../../app/store/activeWorkspace";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { documentCapabilities } from "../../app/workspace/documents";
import type { Workspace } from "../../app/workspace/types";
import { isPlainTextPath } from "../../lib/documents/documentKind";

/** Stable empty list so the comments selectors return a constant reference. */
export const EMPTY_COMMENTS: Workspace["comments"] = [];

/**
 * The note the editor shows, read narrowly from the store: each field is its
 * own subscription, so only what changed re-renders. `content` changes on
 * every keystroke, so only the editor leaf reads this hook.
 */
export function useShownDocument() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  // What this document supports: an external file is a plain document, so the
  // workspace-scoped affordances read these flags (primitives, stable across
  // store ticks), never `kind` directly.
  const commentsEnabled = useWorkspaceStore((state) => documentCapabilities(selectFocusedWorkspace(state)).comments);
  const imageInsertEnabled = useWorkspaceStore((state) => documentCapabilities(selectFocusedWorkspace(state)).imageInsert);
  const focusedWorkspaceId = useWorkspaceStore((state) => selectFocusedWorkspace(state)?.id ?? "");
  const activeFilePath = useWorkspaceStore((state) => selectFocusedWorkspace(state)?.activeFilePath ?? "");
  // Relative links and images in an external file resolve against its own
  // folder: the loose pseudo-workspace has no root of its own.
  const workspacePath = useWorkspaceStore((state) => {
    const workspace = selectFocusedWorkspace(state);
    if (workspace?.kind !== "loose") return workspace?.path;
    const slash = workspace.activeFilePath.lastIndexOf("/");
    return slash > 0 ? workspace.activeFilePath.slice(0, slash) : undefined;
  });
  const content = useWorkspaceStore((state) => {
    const workspace = selectFocusedWorkspace(state);
    return workspace?.activeFilePath ? (workspace.fileContents[workspace.activeFilePath]?.content ?? "") : "";
  });
  const dirty = useWorkspaceStore((state) => {
    const workspace = selectFocusedWorkspace(state);
    return Boolean(workspace?.activeFilePath && workspace.fileContents[workspace.activeFilePath]?.dirty);
  });
  const comments = useWorkspaceStore((state) => selectFocusedWorkspace(state)?.comments ?? EMPTY_COMMENTS);
  const openComments = useMemo(
    () => (activeFilePath ? comments.filter((comment) => comment.filePath === activeFilePath && comment.status === "open") : EMPTY_COMMENTS),
    [activeFilePath, comments],
  );

  return {
    activeWorkspaceId,
    focusedWorkspaceId,
    commentsEnabled,
    imageInsertEnabled,
    activeFilePath,
    plainText: isPlainTextPath(activeFilePath),
    workspacePath,
    content,
    dirty,
    openComments,
  };
}
