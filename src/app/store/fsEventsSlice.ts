import type { WorkspaceState, WorkspaceStoreGet, WorkspaceStoreSet } from "./types";
import { showErrorToast } from "../../features/toast/toastStore";
import {
  applyFileBuffer,
  applyFsEvent,
  applyScanResult,
  markBufferConflict,
  type WorkspaceFsEvent,
} from "../workspaceModel";
import {
  isAgentEditActive,
} from "../agentEditWindow";
import {
  persistComments,
  persistTabs,
} from "./persistence";
import {
  readFile as readFileIpc,
  scanFolders,
  scanWorkspace,
} from "../../lib/ipc/filesClient";
import {
  updateWorkspace,
} from "./internals";

export const createFsEventsSlice = (
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
): Pick<WorkspaceState, "handleFsEvent"> => ({
  handleFsEvent: async (workspaceId: string, event: WorkspaceFsEvent) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      return;
    }

    // A disk change while a snapshot-mode agent run is in flight (or just
    // finished) is the agent's own intended edit, not a conflict — auto-reload
    // rather than prompt. See `agentEditWindow.ts`.
    const { workspace: updated, effect } = applyFsEvent(
      workspace,
      event,
      isAgentEditActive(workspaceId),
    );
    // Skip the store write when nothing changed (e.g. an echo of our own
    // autosave — applyFsEvent returns the workspace unchanged). Writing
    // it anyway would create a fresh `workspaces` array reference and
    // re-render AppShell + the file tree for nothing.
    if (updated !== workspace) {
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspaceId, () => updated),
      }));
    }

    if (effect.type === "reloadFile") {
      try {
        const fileBuffer = await readFileIpc(workspaceId, effect.relativePath);
        // Self-write guard (Zettlr does the same — see Zettlr PR #4760).
        // `applyFsEvent`'s mtime check can race our own autosave and read its
        // watcher echo as an external edit, yielding `reloadFile`. If the file
        // on disk is byte-identical to the buffer we already hold, there is
        // nothing to reload — re-applying it would needlessly churn the editor
        // (e.g. jump the caret out of a table cell). Reload only on a genuine
        // difference; a true external edit still differs and reloads.
        const open = get()
          .workspaces.find((item) => item.id === workspaceId)
          ?.fileContents[effect.relativePath];
        if (open && open.content === fileBuffer.content) {
          return;
        }
        set((state) => ({
          workspaces: updateWorkspace(state.workspaces, workspaceId, (item) =>
            applyFileBuffer(item, effect.relativePath, fileBuffer),
          ),
        }));
        void get().rebuildWorkspaceIndex(workspaceId);
      } catch {
        set((state) => ({
          workspaces: updateWorkspace(state.workspaces, workspaceId, (item) =>
            markBufferConflict(item, effect.relativePath),
          ),
        }));
      }
    } else if (effect.type === "rescan") {
      try {
        const [entries, folders] = await Promise.all([
          scanWorkspace(workspaceId),
          scanFolders(workspaceId).catch(() => [] as string[]),
        ]);
        set((state) => ({
          workspaces: updateWorkspace(state.workspaces, workspaceId, (item) =>
            applyScanResult({ ...item, folders }, entries),
          ),
        }));
        persistTabs(get().workspaces, workspaceId);
        persistComments(get().workspaces, workspaceId, showErrorToast);
        void get().rebuildWorkspaceIndex(workspaceId);
      } catch {
        set((state) => ({
          workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => ({
            ...item,
            scanError: "Workspace rescan failed after filesystem event",
            scanState: "failed",
          })),
        }));
      }
    }
  },
});
