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

// Rescan storm guard: one full scan in flight per workspace, and at most ONE
// queued follow-up — a burst of rescan-worthy events (iCloud sync catching up,
// a folder dragged in) collapses to "the scan running now + one trailing scan
// that sees the final state", never N walks. Module state, keyed by workspace.
const rescanInFlight = new Set<string>();
const rescanQueued = new Set<string>();
// Focus refreshes are a cheap belt-and-braces reconcile (VS Code does the
// same) — but cmd-tabbing around shouldn't walk the vault every time.
const FOCUS_REFRESH_MIN_INTERVAL_MS = 5_000;
const lastRefreshAt = new Map<string, number>();

async function runGuardedRescan(
  workspaceId: string,
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
): Promise<void> {
  if (rescanInFlight.has(workspaceId)) {
    rescanQueued.add(workspaceId);
    return;
  }
  rescanInFlight.add(workspaceId);
  try {
    do {
      rescanQueued.delete(workspaceId);
      try {
        const [entries, folders] = await Promise.all([
          scanWorkspace(workspaceId),
          scanFolders(workspaceId).catch(() => [] as string[]),
        ]);
        lastRefreshAt.set(workspaceId, Date.now());
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
    } while (rescanQueued.has(workspaceId));
  } finally {
    rescanInFlight.delete(workspaceId);
  }
}

export const createFsEventsSlice = (
  set: WorkspaceStoreSet,
  get: WorkspaceStoreGet,
): Pick<WorkspaceState, "handleFsEvent" | "refreshWorkspaceTree"> => ({
  handleFsEvent: async (workspaceId: string, event: WorkspaceFsEvent) => {
    const workspace = get().workspaces.find((item) => item.id === workspaceId);
    if (!workspace) {
      return;
    }

    if (event.kind === "watch-error") {
      // Watching gave up (bounded restarts exhausted). Don't go silently
      // stale — tell the user how to recover.
      showErrorToast(
        "Stopped watching this folder for external changes — reopen it to resume.",
      );
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
    // autosave or create/delete — applyFsEvent returns the workspace
    // unchanged). Writing it anyway would create a fresh `workspaces` array
    // reference and re-render AppShell + the file tree for nothing.
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
    } else if (effect.type === "treeChanged") {
      // The tree was patched in place (one entry added/removed) — persist the
      // (possibly closed) tabs and refresh the search index; no scan needed.
      persistTabs(get().workspaces, workspaceId);
      void get().rebuildWorkspaceIndex(workspaceId);
    } else if (effect.type === "rescan") {
      await runGuardedRescan(workspaceId, set, get);
    }
  },
  refreshWorkspaceTree: async (workspaceId?: string) => {
    const targetId = workspaceId ?? get().activeWorkspaceId;
    if (!targetId) {
      return;
    }
    const last = lastRefreshAt.get(targetId) ?? 0;
    if (Date.now() - last < FOCUS_REFRESH_MIN_INTERVAL_MS) {
      return;
    }
    await runGuardedRescan(targetId, set, get);
  },
});
