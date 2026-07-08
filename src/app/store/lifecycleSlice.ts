import type { WorkspaceState, WorkspaceStoreGet, WorkspaceStoreSet } from "./types";
import { showErrorToast } from "../../features/toast/toastStore";
import { useUiStore } from "./uiStore";
import {
  LOOSE_WORKSPACE_ID,
  applyFileBuffer,
  applyScanResult,
  createLooseWorkspace,
  createWorkspaceFromPath,
  hydrateChatThread,
  hydrateWorkspaceRecords,
  openWorkspaceFile,
  realWorkspaces,
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
  switchWorkspace as switchWorkspaceIpc,
} from "../../lib/ipc/workspaceClient";
import {
  persistTabs,
} from "./persistence";
import {
  pushNavEntry,
} from "./navigation";
import {
  readFile as readFileIpc,
  scanFolders,
  scanWorkspace,
} from "../../lib/ipc/filesClient";
import {
  rebuildWorkspaceIndex as rebuildWorkspaceIndexIpc,
} from "../../lib/ipc/indexClient";
import {
  updateWorkspace,
} from "./internals";

/**
 * Run a task once the app is idle. Keeps a heavy job (the full search-index
 * build) off the launch critical path: run inline with load it competes with
 * first paint and makes a large workspace feel slow to open. Falls back to a
 * short timeout where `requestIdleCallback` is unavailable (e.g. jsdom).
 */
function whenIdle(task: () => void): void {
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(() => task(), { timeout: 2000 });
  } else {
    setTimeout(task, 1200);
  }
}

export const createLifecycleSlice = (
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
): Pick<WorkspaceState, "activeWorkspace" | "activeWorkspaceId" | "workspaces" | "addWorkspace" | "removeWorkspace" | "switchWorkspace" | "hydrateWorkspaces" | "loadActiveWorkspaceFiles" | "rebuildWorkspaceIndex"> => ({
  activeWorkspace: () => {
    const { activeWorkspaceId, workspaces } = get();
    return workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  },
  activeWorkspaceId: null,
  // The loose pseudo-workspace (external files, #113) is always present and
  // always LAST; `activeWorkspaceId` never points at it — `focusedArea` says
  // whether the editor is showing one of its files.
  workspaces: [createLooseWorkspace()],
  addWorkspace: (path: string) => {
    const workspace = createWorkspaceFromPath(path);

    set((state) => {
      const existingWorkspace = state.workspaces.find((item) => item.id === workspace.id);
      if (existingWorkspace) {
        return {
          activeWorkspaceId: existingWorkspace.id,
        };
      }

      // Insert before the loose pseudo-workspace so it stays last.
      const loose = state.workspaces.filter((item) => item.kind === "loose");
      return {
        activeWorkspaceId: workspace.id,
        workspaces: [...realWorkspaces(state.workspaces), workspace, ...loose],
      };
    });

    return workspace.id;
  },
  removeWorkspace: (workspaceId: string) => {
    if (workspaceId === LOOSE_WORKSPACE_ID) {
      return;
    }
    set((state) => {
      const workspaces = state.workspaces.filter((workspace) => workspace.id !== workspaceId);
      const activeWorkspaceId =
        state.activeWorkspaceId === workspaceId
          ? realWorkspaces(workspaces)[0]?.id ?? null
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
    if (!workspace || workspace.kind === "loose") {
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
      // Switching workspaces hands the editor to that workspace's document.
      return {
        activeWorkspaceId: workspace.id,
        workspaces: updated,
        focusedArea: "workspace" as const,
        ...(navPatch ?? {}),
      };
    });
    // Persist the active workspace AND its open timestamp on the backend so the
    // next launch restores this workspace (workspace_switch is the only command
    // that writes active_workspace_id; mark_opened bumps last_opened_at only).
    void switchWorkspaceIpc(workspaceId).catch(() => undefined);
  },
  hydrateWorkspaces: (workspaceList: WorkspaceListResult) => {
    set((state) => {
      // Records cover only REAL workspaces — carry the loose pseudo-workspace
      // (and its open external files) across every hydrate, kept last.
      const loose =
        state.workspaces.find((workspace) => workspace.kind === "loose") ??
        createLooseWorkspace();
      const real = hydrateWorkspaceRecords(
        realWorkspaces(state.workspaces),
        workspaceList.workspaces,
      );
      const activeWorkspaceId =
        workspaceList.activeWorkspaceId ?? real[0]?.id ?? state.activeWorkspaceId;

      return {
        activeWorkspaceId,
        onboarding: workspaceList.onboarding,
        workspaces: [...real, loose],
      };
    });
  },
  loadActiveWorkspaceFiles: async (attempt = 1) => {
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) {
      return;
    }
    set((state) => ({
      workspaces: updateWorkspace(state.workspaces, workspaceId, (item) =>
        item.scanState === "loading" ? item : { ...item, scanState: "loading", scanError: null },
      ),
    }));

    // The file already open (a reopened workspace) is known before the scan —
    // read its content CONCURRENTLY with the scan/comments/conversation so the
    // editor paints in one round-trip, not a second sequential read. A fresh
    // folder has no active file yet; its note is read after the scan.
    const knownActiveFile = get().activeWorkspace()?.activeFilePath || "";
    try {
      // Independent IPC calls, run concurrently rather than awaited in series —
      // the load is a single round-trip instead of four.
      const [entries, folders, comments, conversation, knownBuffer] = await Promise.all([
        scanWorkspace(workspaceId),
        scanFolders(workspaceId).catch(() => [] as string[]),
        // Guarded so only the SCAN owns the catch below — a comments hiccup must
        // not read as "couldn't read your vault" or enter the scan retry. On
        // failure fall back to the comments already in state (null marker), NOT
        // an empty list: persistComments writes workspace.comments wholesale, so
        // hydrating [] would wipe real comments on the next persist.
        loadWorkspaceComments(workspaceId).catch(() => null),
        // Active conversation (most-recently-OPENED, non-archived) so the chat
        // survives reload. Best-effort — a failure mustn't block the scan.
        loadActiveConversation(workspaceId).catch(() => null),
        knownActiveFile
          ? readFileIpc(workspaceId, knownActiveFile).catch(() => null)
          : Promise.resolve(null),
      ]);
      set((state) => ({
        workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => {
          let scanned = applyScanResult(
            { ...item, comments: comments ?? item.comments, folders },
            entries,
          );
          // Apply the concurrently-read buffer if its file survived the scan.
          if (knownActiveFile && knownBuffer && scanned.activeFilePath === knownActiveFile) {
            scanned = applyFileBuffer(scanned, knownActiveFile, knownBuffer);
          }
          // Open the seeded Welcome note (or the first note) as PART of the scan
          // result — a freshly opened folder (the onboarding starter, or any
          // first open) then resolves straight to a document, with no "No note
          // open" flicker between the scan landing and the file opening.
          const withActiveFile =
            !scanned.activeFilePath &&
            scanned.openFilePaths.length === 0 &&
            scanned.files.length > 0
              ? openWorkspaceFile(
                  scanned,
                  (
                    scanned.files.find((entry) => entry.relativePath === "Welcome.md") ??
                    scanned.files[0]
                  ).relativePath,
                )
              : scanned;
          return conversation
            ? {
                ...withActiveFile,
                chatThread: hydrateChatThread(withActiveFile.chatThread, conversation),
              }
            : withActiveFile;
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
      // Build the search index off the launch path: for a large workspace the
      // full snapshot build is CPU-heavy and, run inline with load, competes
      // with first paint. Defer to idle — search shows "Indexing…" until it lands.
      whenIdle(() => void get().rebuildWorkspaceIndex(workspaceId));
    } catch (error) {
      // A scan/load failure at boot is usually transient — the iCloud vault not
      // yet materialized, or a relaunch racing the previous instance's handles.
      // Re-read after a backoff so it heals itself once the vault is readable,
      // rather than stranding the tree on a false "no notes". Retry only while
      // this workspace is still the active one, and only a few times before
      // giving up to a retryable "failed" state (the tree shows a Retry button).
      const MAX_ATTEMPTS = 4;
      if (attempt < MAX_ATTEMPTS && get().activeWorkspaceId === workspaceId) {
        const delayMs = [1000, 2500, 5000][attempt - 1] ?? 5000;
        setTimeout(() => void get().loadActiveWorkspaceFiles(attempt + 1), delayMs);
      } else {
        const message = error instanceof Error ? error.message : "Workspace scan failed";
        set((state) => ({
          workspaces: updateWorkspace(state.workspaces, workspaceId, (item) => ({
            ...item,
            scanError: message,
            scanState: "failed",
          })),
        }));
      }
    }
  },
  rebuildWorkspaceIndex: async (workspaceId?: string) => {
    const targetWorkspaceId = workspaceId ?? get().activeWorkspaceId;
    // External files are plain documents — no search index (#113 v1).
    if (!targetWorkspaceId || targetWorkspaceId === LOOSE_WORKSPACE_ID) {
      return;
    }
    const inFlight = indexRebuildFlights.get(targetWorkspaceId);
    if (inFlight) {
      // A crawl is running: remember that the workspace changed again and let
      // ONE trailing run pick everything up — a burst of saves must not queue
      // a burst of full crawls (#106).
      inFlight.trailing = true;
      return inFlight.current;
    }

    const flight = { current: Promise.resolve(), trailing: false };
    flight.current = (async () => {
      // The index lives in its own store (useIndexStore) — NOT on the workspace —
      // so a rebuild on every save doesn't churn the workspace object and
      // re-render the file tree / tabs / sidebar.
      do {
        flight.trailing = false;
        useIndexStore.getState().setIndexing(targetWorkspaceId);
        try {
          const snapshot = await rebuildWorkspaceIndexIpc(targetWorkspaceId);
          useIndexStore.getState().setSnapshot(targetWorkspaceId, snapshot);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Workspace index failed";
          // The backend's own single-flight guard declined us — another invoke
          // is already crawling and will publish its snapshot; stay "indexing".
          if (!message.includes("already in progress")) {
            useIndexStore.getState().setFailed(targetWorkspaceId, message);
          }
        }
      } while (flight.trailing);
      indexRebuildFlights.delete(targetWorkspaceId);
    })();
    indexRebuildFlights.set(targetWorkspaceId, flight);
    return flight.current;
  },
});

/** One in-flight index crawl per workspace plus at most one coalesced
 * trailing run — rebuilds are requested on every save/rename/delete, watcher
 * event, and search open, and each is a full-vault crawl (#106). */
const indexRebuildFlights = new Map<string, { current: Promise<void>; trailing: boolean }>();
