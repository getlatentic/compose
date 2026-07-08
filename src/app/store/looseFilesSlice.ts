import type { WorkspaceState, WorkspaceStoreGet, WorkspaceStoreSet } from "./types";
import { showErrorToast } from "../../features/toast/toastStore";
import {
  externalAdd,
  externalRemove,
} from "../../lib/ipc/externalFilesClient";
import {
  LOOSE_WORKSPACE_ID,
  closeWorkspaceFileTab,
  markBufferSaved,
  openWorkspaceFile,
  reorderOpenTabs,
  type Workspace,
  type WorkspaceFileEntry,
} from "../workspaceModel";
import { flushActiveEditor } from "../../lib/editor/editorFlush";
import {
  commitOutgoingFile,
  loadBufferIfMissing,
  settleLooseFocus,
  writeBufferFor,
} from "./filesSlice";
import { selectLooseWorkspace } from "./activeWorkspace";
import { updateWorkspace } from "./internals";
import { persistTabs } from "./persistence";
import { pruneNavHistory, pushNavEntry } from "./navigation";

/**
 * External files (#113): documents opened from outside any workspace, edited
 * at their real absolute path. They live in the loose pseudo-workspace —
 * present in `workspaces[]` so buffers/tabs/save reuse the workspace
 * machinery, but never the ACTIVE workspace: `focusedArea` says whether the
 * editor is showing it, while the sidebar tree/chat/switcher stay on the real
 * workspace throughout.
 */

function looseWorkspaceOf(get: WorkspaceStoreGet): Workspace | null {
  return selectLooseWorkspace(get());
}

/** Registry records → tree entries. mtime/size are placeholders — the sidebar
 *  shows names only, and buffers stat on read. */
function looseEntries(files: { path: string }[]): WorkspaceFileEntry[] {
  return files.map((record) => ({
    relativePath: record.path,
    lastModifiedMs: 0,
    sizeBytes: 0,
  }));
}

export const createLooseFilesSlice = (
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
): Pick<
  WorkspaceState,
  | "focusedArea"
  | "focusedWorkspace"
  | "openLooseFile"
  | "selectLooseFile"
  | "closeLooseTab"
  | "reorderLooseTab"
  | "removeLooseFile"
  | "hydrateExternalFiles"
> => ({
  focusedArea: "workspace",
  focusedWorkspace: () => {
    const state = get();
    return state.focusedArea === "loose" ? looseWorkspaceOf(get) : state.activeWorkspace();
  },
  hydrateExternalFiles: (list) => {
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, LOOSE_WORKSPACE_ID, (item) => {
        const files = looseEntries(list.files);
        const known = new Set(files.map((entry) => entry.relativePath));
        const openFilePaths = list.openPaths.filter((path) => known.has(path));
        return {
          ...item,
          files,
          openFilePaths,
          activeFilePath: openFilePaths.includes(list.activePath) ? list.activePath : "",
        };
      }),
    }));
  },
  openLooseFile: async (absolutePath: string) => {
    let added;
    try {
      added = await externalAdd(absolutePath);
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : "Could not open file");
      return;
    }
    // The registry canonicalizes (symlinks, `/tmp` → `/private/tmp`), so key
    // everything on ITS spelling of the path, not the OS event's. UNION with
    // the entries already in the store: multi-file opens run concurrently and
    // their add-responses can land out of order, so a stale (shorter) list
    // must never drop a row a sibling call just added — losing the row also
    // silently stops that file's autosave (the implicit-save guard checks it).
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, LOOSE_WORKSPACE_ID, (item) => {
        const known = new Set(item.files.map((entry) => entry.relativePath));
        const fresh = looseEntries(added.list.files).filter(
          (entry) => !known.has(entry.relativePath),
        );
        return fresh.length === 0 ? item : { ...item, files: [...item.files, ...fresh] };
      }),
    }));
    await get().selectLooseFile(added.path);
  },
  selectLooseFile: async (absolutePath: string) => {
    const loose = looseWorkspaceOf(get);
    if (!loose || !loose.files.some((entry) => entry.relativePath === absolutePath)) {
      return;
    }
    commitOutgoingFile(get, { id: LOOSE_WORKSPACE_ID, path: absolutePath });

    set((state) => {
      const updated = updateWorkspace(state.workspaces, LOOSE_WORKSPACE_ID, (item) =>
        openWorkspaceFile(item, absolutePath),
      );
      const navPatch = pushNavEntry(state, {
        kind: "file",
        id: absolutePath,
        workspaceId: LOOSE_WORKSPACE_ID,
      });
      return {
        workspaces: updated,
        focusedArea: "loose" as const,
        ...(navPatch ?? {}),
      };
    });
    persistTabs(get().workspaces, LOOSE_WORKSPACE_ID);

    await loadBufferIfMissing(set, get, LOOSE_WORKSPACE_ID, absolutePath);
  },
  closeLooseTab: (absolutePath: string) => {
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, LOOSE_WORKSPACE_ID, (item) =>
        closeWorkspaceFileTab(item, absolutePath),
      ),
    }));
    settleLooseFocus(set, get);
    persistTabs(get().workspaces, LOOSE_WORKSPACE_ID);
  },
  reorderLooseTab: (fromPath: string, toPath: string) => {
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, LOOSE_WORKSPACE_ID, (item) => ({
        ...item,
        openFilePaths: reorderOpenTabs(item.openFilePaths, fromPath, toPath),
      })),
    }));
    persistTabs(get().workspaces, LOOSE_WORKSPACE_ID);
  },
  removeLooseFile: async (absolutePath: string) => {
    // Removing = stop tracking; the file on disk is untouched. Persist this
    // file's pending edits first (best-effort) so nothing typed is lost with
    // the tab — just this one buffer, not an app-wide flush. A CONFLICTED
    // buffer is skipped like the quit-flush skips it: writing it would
    // force-overwrite the newer on-disk version this row's ✕ promises to
    // leave alone.
    flushActiveEditor();
    const loose = looseWorkspaceOf(get);
    const buffer = loose?.fileContents[absolutePath];
    if (loose && buffer?.dirty && !buffer.conflict) {
      try {
        const result = await writeBufferFor(loose, absolutePath, buffer);
        set((state) => ({
          workspaces: updateWorkspace(state.workspaces, LOOSE_WORKSPACE_ID, (item) =>
            markBufferSaved(item, absolutePath, result.lastModifiedMs),
          ),
        }));
      } catch {
        // The remove still proceeds — the user asked to stop tracking.
      }
    }

    let registered;
    try {
      registered = await externalRemove(absolutePath);
    } catch (error) {
      showErrorToast(error instanceof Error ? error.message : "Could not remove file");
      return;
    }
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, LOOSE_WORKSPACE_ID, (item) => {
        const withoutTab = closeWorkspaceFileTab(item, absolutePath);
        return { ...withoutTab, files: looseEntries(registered.files) };
      }),
      // Back/Forward must not resurrect the removed file (#45) — a loose nav
      // entry re-adds on apply, which would undo the removal.
      ...pruneNavHistory(
        state,
        (entry) =>
          !(
            entry.kind === "file" &&
            entry.workspaceId === LOOSE_WORKSPACE_ID &&
            entry.id === absolutePath
          ),
      ),
    }));
    settleLooseFocus(set, get);
    persistTabs(get().workspaces, LOOSE_WORKSPACE_ID);
  },
});
