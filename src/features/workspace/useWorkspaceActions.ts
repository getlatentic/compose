import { useMemo, useState } from "react";
import {
  addWorkspace,
  canUseNativeFolderPicker,
  removeWorkspace,
  selectWorkspaceFolder,
  type WorkspaceRecord,
} from "../../lib/ipc/workspaceClient";
import {
  applyImportedFolder,
  importFolderFromPicker,
  type ImportedFile,
} from "../../lib/workspace/folderImport";
import { countUnsavedBuffers } from "../../lib/workspace/unsavedBuffers";
import { useConfirm } from "../dialogs/ConfirmProvider";
import { useWorkspaceStore } from "../../app/workspaceStore";

// Browser-preview only: the virtual "sample workspace" id (the path is just an
// identifier in the browser — no disk access). Overridable for local dev.
const browserPreviewWorkspacePath =
  import.meta.env.VITE_SAMPLE_WORKSPACE ?? "/sample-vault";

/**
 * The open-folder / recent / remove logic that used to live in the (now
 * deleted) DashboardScreen. Extracted as a single hook so both surfaces that
 * open workspaces — the top-bar {@link WorkspaceMenu} and the no-workspace
 * welcome card — share one implementation instead of duplicating it.
 *
 * Opening a workspace flows through the store's `switchWorkspace` so the shell
 * activates it in place (there is no separate dashboard view to leave anymore).
 */
export interface WorkspaceActions {
  /** Recent workspaces, newest-opened first, mapped to lightweight records. */
  recent: WorkspaceRecord[];
  /** True while an open-folder / sample import is in flight. */
  busy: boolean;
  /** The last open error, or null. */
  error: string | null;
  /** Whether the host can use the native folder picker (desktop) vs the
   * browser `<input webkitdirectory>` import + sample workspace. */
  canOpenNativeFolder: boolean;
  /** Open the OS folder picker (desktop) or import a folder (browser), then
   * activate the resulting workspace. */
  openFolder: () => Promise<void>;
  /** Browser-only: open the bundled sample workspace. */
  openSample: () => Promise<void>;
  /** Activate an already-known workspace by id. */
  openWorkspace: (workspaceId: string) => void;
  /** Drop a workspace from the recent list (persisted, with a store fallback). */
  removeRecent: (workspaceId: string) => Promise<void>;
}

export function useWorkspaceActions(): WorkspaceActions {
  const hydrateWorkspaces = useWorkspaceStore((state) => state.hydrateWorkspaces);
  const switchWorkspace = useWorkspaceStore((state) => state.switchWorkspace);
  const removeStoreWorkspace = useWorkspaceStore((state) => state.removeWorkspace);
  const confirm = useConfirm();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to a string KEY of only the recent-list-relevant metadata
  // (id / name / path / lastOpenedAt), NOT the whole `workspaces` array.
  // The key is stable across buffer-content edits, so the memoised
  // WorkspaceMenu and the welcome card that consume `recent` don't
  // re-render on every keystroke-driven autosave. (See the re-render-
  // cascade investigation.) Buildig the records reads via getState so we
  // don't hold a content-coupled subscription.
  const recentKey = useWorkspaceStore((state) =>
    state.workspaces
      .filter((w) => w.kind === "real")
      .map((w) => `${w.id}\u0000${w.name}\u0000${w.path}\u0000${w.lastOpenedAt ?? ""}`)
      .join("\u0001"),
  );
  const recent = useMemo<WorkspaceRecord[]>(() => {
    return useWorkspaceStore
      .getState()
      // The loose pseudo-workspace (external files) is not a folder the
      // switcher can offer.
      .workspaces.filter((workspace) => workspace.kind === "real")
      .map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        path: workspace.path,
        lastOpenedAt: workspace.lastOpenedAt,
      }))
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
    // recentKey captures every field the records depend on; getState reads
    // the live workspaces at recompute time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentKey]);

  async function openPath(path: string, importedFiles?: ImportedFile[]) {
    setBusy(true);
    try {
      const list = await addWorkspace(path);
      if (importedFiles && list.activeWorkspaceId) {
        // Populate the virtual workspace before opening it, so the scan
        // that follows reads the imported files (not the demo seed).
        await applyImportedFolder(list.activeWorkspaceId, importedFiles);
      }
      hydrateWorkspaces(list);
      const newWorkspace =
        list.workspaces.find((item) => item.id === list.activeWorkspaceId) ??
        list.workspaces[list.workspaces.length - 1];
      if (newWorkspace) {
        switchWorkspace(newWorkspace.id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open folder");
    } finally {
      setBusy(false);
    }
  }

  async function openFolder() {
    setError(null);
    if (canUseNativeFolderPicker()) {
      const path = await selectWorkspaceFolder();
      if (!path) return;
      await openPath(path);
      return;
    }
    // Browser: import a real folder into the persisted virtual workspace.
    const imported = await importFolderFromPicker();
    if (!imported) return;
    if (imported.files.length === 0) {
      setError("No Markdown files were found in that folder.");
      return;
    }
    await openPath(`/${imported.folderName}`, imported.files);
  }

  async function openSample() {
    setError(null);
    await openPath(browserPreviewWorkspacePath);
  }

  function openWorkspace(workspaceId: string) {
    switchWorkspace(workspaceId);
  }

  async function removeRecent(workspaceId: string) {
    // Removing drops the workspace's in-memory buffers with it, so warn before
    // discarding unsaved edits (the folder's saved files on disk are untouched).
    const workspace = useWorkspaceStore
      .getState()
      .workspaces.find((item) => item.id === workspaceId);
    const unsaved = workspace ? countUnsavedBuffers(workspace) : 0;
    if (workspace && unsaved > 0) {
      const confirmed = await confirm({
        title: "Remove workspace with unsaved changes?",
        message: `“${workspace.name}” has ${unsaved} ${
          unsaved === 1 ? "file" : "files"
        } with unsaved changes. Removing it from the list discards those edits. Your saved files on disk are not deleted.`,
        confirmLabel: "Remove anyway",
        danger: true,
      });
      if (!confirmed) {
        return;
      }
    }
    try {
      const list = await removeWorkspace(workspaceId);
      hydrateWorkspaces(list);
    } catch {
      removeStoreWorkspace(workspaceId);
    }
  }

  return {
    recent,
    busy,
    error,
    canOpenNativeFolder: canUseNativeFolderPicker(),
    openFolder,
    openSample,
    openWorkspace,
    removeRecent,
  };
}
