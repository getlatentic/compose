import type { Workspace } from "../../app/workspaceModel";

/**
 * How many of a workspace's open buffers hold unsaved edits. Removing a
 * workspace drops its in-memory `fileContents`, so a dirty buffer's edits are
 * lost with it — callers use this to warn before discarding unsaved work, and
 * the quit-time `beforeunload` guard uses it to decide whether to prompt.
 */
export function countUnsavedBuffers(workspace: Pick<Workspace, "fileContents">): number {
  return Object.values(workspace.fileContents).filter((buffer) => buffer.dirty).length;
}
