import type { WorkspaceState, WorkspaceStoreGet, WorkspaceStoreSet } from "./types";
import { showErrorToast } from "../../features/toast/toastStore";
import { useUiStore } from "./uiStore";
import {
  applyFileBuffer,
  applyScanResult,
  createWorkspaceFromPath,
  hydrateChatThread,
  hydrateWorkspaceRecords,
  type WorkspaceListResult,
} from "../workspaceModel";
import { useIndexStore } from "./indexStore";
import {
  loadActiveConversation,
} from "../../lib/ipc/conversationsClient";
import {
  loadWorkspaceComments,
} from "../../lib/ipc/commentsClient";
import {
  markWorkspaceOpened,
} from "../../lib/ipc/workspaceClient";
import {
  persistTabs,
} from "./persistence";
import {
  pushNavEntry,
} from "./navigation";
import {
  readFile as readFileIpc,
  scanWorkspace,
} from "../../lib/ipc/filesClient";
import {
  rebuildWorkspaceIndex as rebuildWorkspaceIndexIpc,
} from "../../lib/ipc/indexClient";
import {
  updateWorkspace,
} from "./internals";

export const createLifecycleSlice = (
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
): Pick<WorkspaceState, "activeWorkspace" | "activeWorkspaceId" | "workspaces" | "addWorkspace" | "removeWorkspace" | "switchWorkspace" | "hydrateWorkspaces" | "loadActiveWorkspaceFiles" | "rebuildWorkspaceIndex"> => ({
  activeWorkspace: () => {
    const { activeWorkspaceId, workspaces } = get();
    return workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  },
  activeWorkspaceId: null,
  workspaces: [],
  addWorkspace: (path: string) => {
    const workspace = createWorkspaceFromPath(path);

    set((state) => {
      const existingWorkspace = state.workspaces.find((item) => item.id === workspace.id);
      if (existingWorkspace) {
        return {
          activeWorkspaceId: existingWorkspace.id,
        };
      }

      return {
        activeWorkspaceId: workspace.id,
        workspaces: [...state.workspaces, workspace],
      };
    });

    return workspace.id;
  },
  removeWorkspace: (workspaceId: string) => {
    set((state) => {
      const workspaces = state.workspaces.filter((workspace) => workspace.id !== workspaceId);
      const activeWorkspaceId =
        state.activeWorkspaceId === workspaceId
          ? workspaces[0]?.id ?? null
          : state.activeWorkspaceId;

      return {
        activeWorkspaceId,
        workspaces,
      };
    });
    if (!get().activeWorkspaceId) {
      useUiStore.getState().closeChat();
    }
  },
  switchWorkspace: (workspaceId: string) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      return;
    }

    const nowMs = Date.now();
    set((state) => {
      const updated = updateWorkspace(state.workspaces, workspaceId, (item) => ({
        ...item,
        lastOpenedAt: nowMs,
      }));
      // Push a nav entry for the workspace's active file (or its first file)
      // so back/forward steps return to the right document. No active file →
      // skip the push; the next selectFile/openConversation will record one.
      const target = workspace.activeFilePath;
      const navPatch = target
        ? pushNavEntry(state, { kind: "file", id: target, workspaceId })
        : null;
      return navPatch
        ? { activeWorkspaceId: workspace.id, workspaces: updated, ...navPatch }
        : { activeWorkspaceId: workspace.id, workspaces: updated };
    });
    void markWorkspaceOpened(workspaceId).catch(() => undefined);
  },
  hydrateWorkspaces: (workspaceList: WorkspaceListResult) => {
    set((state) => {
      const workspaces = hydrateWorkspaceRecords(state.workspaces, workspaceList.workspaces);
      const activeWorkspaceId =
        workspaceList.activeWorkspaceId ?? workspaces[0]?.id ?? state.activeWorkspaceId;

      return {
        activeWorkspaceId,
        onboarding: workspaceList.onboarding,
        workspaces,
      };
    });
  },
  loadActiveWorkspaceFiles: async () => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) {
      return;
    }
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspaceId, (item) =>
        item.scanState === "loading" ? item : { ...item, scanState: "loading", scanError: null },
      ),
    }));

    try {
      const entries = await scanWorkspace(workspaceId);
      const comments = await loadWorkspaceComments(workspaceId);
      // Restore the workspace's active conversation (most-recently-OPENED
      // non-archived, non-deleted) so the chat survives reload. Best-effort:
      // a load failure shouldn't block the scan/comments restore.
      const conversation = await loadActiveConversation(workspaceId).catch(() => null);
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => {
          const scanned = applyScanResult({ ...item, comments }, entries);
          return conversation
            ? { ...scanned, chatThread: hydrateChatThread(scanned.chatThread, conversation) }
            : scanned;
        }),
      }));
      persistTabs(get().workspaces, workspaceId);
      // Populate the conversation history list for the panel's switcher.
      void get().loadConversations(workspaceId);

      const refreshed = get().workspaces.find((item) => item.id === workspaceId);
      const activeFilePath = refreshed?.activeFilePath ?? "";
      if (refreshed && activeFilePath && !refreshed.fileContents[activeFilePath]) {
        try {
          const buffer = await readFileIpc(workspaceId, activeFilePath);
          set((state) => ({
            workspaces: updateWorkspace(state.workspaces, workspaceId, (item) =>
              applyFileBuffer(item, activeFilePath, buffer),
            ),
          }));
        } catch {
          showErrorToast(`Could not restore open file: ${activeFilePath}`);
        }
      }
      void get().rebuildWorkspaceIndex(workspaceId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workspace scan failed";
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => ({
          ...item,
          scanError: message,
          scanState: "failed",
        })),
      }));
    }
  },
  rebuildWorkspaceIndex: async (workspaceId?: string) => {
    const targetWorkspaceId = workspaceId ?? get().activeWorkspaceId;
    if (!targetWorkspaceId) {
      return;
    }

    // The index lives in its own store (useIndexStore) — NOT on the workspace —
    // so a rebuild on every save doesn't churn the workspace object and
    // re-render the file tree / tabs / sidebar.
    useIndexStore.getState().setIndexing(targetWorkspaceId);
    try {
      const snapshot = await rebuildWorkspaceIndexIpc(targetWorkspaceId);
      useIndexStore.getState().setSnapshot(targetWorkspaceId, snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workspace index failed";
      useIndexStore.getState().setFailed(targetWorkspaceId, message);
    }
  },
});
