import { markBufferConflict } from "./files";
import { closeWorkspaceFileTab } from "./tabs";
import type { FsEventEffect, Workspace, WorkspaceFileEntry, WorkspaceFsEvent } from "./types";

/**
 * A file-system event on a workspace's folder: what it changes in the workspace, and what the app should do about it.
 */

export function applyFsEvent(
  workspace: Workspace,
  event: WorkspaceFsEvent,
  /**
   * Whether this disk change is attributable to a just-run agent (a
   * `snapshot`-mode run editing the user's real files — see
   * `agentEditWindow.ts`). When true, an agent's edit to a file the user has
   * unsaved changes in **auto-reloads** instead of raising a conflict banner:
   * the edit is intended, already reviewed in-chat, and undoable via version
   * history. A genuine external edit (no agent run in flight) still conflicts.
   */
  agentEdit = false,
): { workspace: Workspace; effect: FsEventEffect } {
  if (event.kind === "rescan") {
    // The watcher lost sync (queue overflow, or a gap while re-establishing):
    // events were missed, so only a full scan reconciles the tree.
    return { workspace, effect: { type: "rescan" } };
  }
  if (event.kind === "watch-error") {
    // Watching gave up (bounded restarts exhausted) — the slice surfaces it.
    return { workspace, effect: { type: "noop" } };
  }
  if (event.kind === "removed") {
    return applyRemovedPath(workspace, event.relativePath);
  }
  if (event.kind === "created") {
    return applyCreatedPath(workspace, event);
  }

  const buffer = workspace.fileContents[event.relativePath];

  // Echo of our OWN write (autosave / manual save), or an older event:
  // the open buffer's mtime is already >= the event's. Return the
  // workspace UNCHANGED. We previously rebuilt `files` here to refresh the
  // entry's mtime, but that churns the `files` array reference on every
  // autosave-driven watcher echo and re-renders the entire file tree
  // (incl. each row's Carbon OverflowMenu) for nothing — confirmed via
  // react-scan. Conflict detection keys off the *buffer's* mtime, not the
  // file-entry's, so skipping the entry-mtime refresh here is safe.
  if (buffer && event.lastModifiedMs != null && event.lastModifiedMs <= buffer.lastModifiedMs) {
    return { workspace, effect: { type: "noop" } };
  }

  const updatedFiles = event.lastModifiedMs
    ? workspace.files.map((entry) =>
        entry.relativePath === event.relativePath
          ? { ...entry, lastModifiedMs: event.lastModifiedMs as number }
          : entry,
      )
    : workspace.files;

  if (!buffer) {
    return {
      workspace: { ...workspace, files: updatedFiles },
      effect: { type: "noop" },
    };
  }

  // A dirty buffer changing on disk is a conflict — *unless* the change is the
  // agent's own intended edit, in which case we auto-reload to the new content
  // (the conflict prompt would be redundant with the in-chat applied diff).
  if (buffer.dirty && !agentEdit) {
    return {
      workspace: markBufferConflict({ ...workspace, files: updatedFiles }, event.relativePath),
      effect: { type: "noop" },
    };
  }

  return {
    workspace: { ...workspace, files: updatedFiles },
    effect: { type: "reloadFile", relativePath: event.relativePath },
  };
}

/** Every ancestor directory of a relative path, outermost first. */
function ancestorDirs(relativePath: string): string[] {
  const parts = relativePath.split("/");
  const chain: string[] = [];
  for (let index = 1; index < parts.length; index += 1) {
    chain.push(parts.slice(0, index).join("/"));
  }
  return chain;
}

/**
 * A `created` event patches the tree in place — no scan. The one exception is
 * an UNKNOWN directory: it may have arrived with contents (a folder dragged in
 * via Finder emits only the top-level event), and only a scan can see inside —
 * so that case alone asks for one reconciling rescan. Echoes of our own
 * creates (path already known) return the workspace untouched, so the
 * unchanged-reference check upstream skips the store write entirely.
 */
function applyCreatedPath(
  workspace: Workspace,
  event: WorkspaceFsEvent,
): { workspace: Workspace; effect: FsEventEffect } {
  if (event.isDir) {
    if (workspace.folders.includes(event.relativePath)) {
      return { workspace, effect: { type: "noop" } };
    }
    return { workspace, effect: { type: "rescan" } };
  }
  if (workspace.files.some((entry) => entry.relativePath === event.relativePath)) {
    return { workspace, effect: { type: "noop" } };
  }
  const entry: WorkspaceFileEntry = {
    lastModifiedMs: event.lastModifiedMs ?? 0,
    relativePath: event.relativePath,
    sizeBytes: event.sizeBytes ?? 0,
  };
  const files = [...workspace.files, entry].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath),
  );
  // The note may land in a folder we haven't materialized (its own dir event
  // can be skipped or arrive later) — add the chain so the tree can place it.
  const missing = ancestorDirs(event.relativePath).filter(
    (dir) => !workspace.folders.includes(dir),
  );
  const folders = missing.length
    ? [...workspace.folders, ...missing].sort((a, b) => a.localeCompare(b))
    : workspace.folders;
  return { workspace: { ...workspace, files, folders }, effect: { type: "treeChanged" } };
}

/**
 * A `removed` event resolves against what the tree actually knows: a known
 * file closes its tab and leaves the list; a known folder takes its whole
 * subtree (tabs included) with it. An unknown path (a non-md file, a stale
 * echo of our own delete) returns the workspace untouched. A transient scan
 * miss can never delete anything here — only a real watcher removal reaches
 * this point (see applyScanResult, which deliberately never prunes).
 */
function applyRemovedPath(
  workspace: Workspace,
  relativePath: string,
): { workspace: Workspace; effect: FsEventEffect } {
  // Known as a file OR as an open tab: a transient scan miss drops the entry
  // from `files` while deliberately keeping the tab (see applyScanResult) —
  // the confirmed deletion arriving later must still close that tab.
  const isKnownFile =
    workspace.files.some((entry) => entry.relativePath === relativePath) ||
    workspace.openFilePaths.includes(relativePath);
  if (isKnownFile) {
    // An EXTERNAL removal of a file with unsaved edits keeps the tab and its
    // buffer — the user's work outlives the file, and an explicit save
    // re-creates it deliberately. Only the tree row goes. (Implicit saves
    // never write a path that is missing from `files`, so keeping the buffer
    // cannot silently resurrect the file.)
    const buffer = workspace.fileContents[relativePath];
    if (buffer?.dirty) {
      const files = workspace.files.filter((entry) => entry.relativePath !== relativePath);
      return { workspace: { ...workspace, files }, effect: { type: "treeChanged" } };
    }
    const closed = closeWorkspaceFileTab(workspace, relativePath);
    const files = closed.files.filter((entry) => entry.relativePath !== relativePath);
    return { workspace: { ...closed, files }, effect: { type: "treeChanged" } };
  }
  if (workspace.folders.includes(relativePath)) {
    const prefix = `${relativePath}/`;
    let updated = workspace;
    for (const entry of workspace.files) {
      if (entry.relativePath.startsWith(prefix)) {
        updated = closeWorkspaceFileTab(updated, entry.relativePath);
      }
    }
    const files = updated.files.filter((entry) => !entry.relativePath.startsWith(prefix));
    const folders = updated.folders.filter(
      (dir) => dir !== relativePath && !dir.startsWith(prefix),
    );
    return { workspace: { ...updated, files, folders }, effect: { type: "treeChanged" } };
  }
  return { workspace, effect: { type: "noop" } };
}
