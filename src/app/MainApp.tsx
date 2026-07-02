import { useEffect } from "react";
import { subscribeToWorkspaceFs } from "../lib/ipc/fileWatcherClient";
import { AppShell } from "./AppShell";
import { useWorkspaceStore } from "./workspaceStore";
import { useUiStore } from "./store/uiStore";
import { useSaveOnExit } from "./useSaveOnExit";

/**
 * The main app screen (mounted by AppRouter once boot + onboarding are done).
 * Owns the workspace-level effects (file scan, fs-watch, ⌘S, unsaved-warning)
 * and renders the shell immediately. Subscribes to only `activeWorkspaceId`
 * (changes on workspace switch, never on a keystroke), so document churn lives
 * entirely in the leaf regions under AppShell, not here.
 */
export function MainApp() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const handleFsEvent = useWorkspaceStore((state) => state.handleFsEvent);
  const loadActiveWorkspaceFiles = useWorkspaceStore((state) => state.loadActiveWorkspaceFiles);
  const refreshWorkspaceTree = useWorkspaceStore((state) => state.refreshWorkspaceTree);
  const saveActiveFile = useWorkspaceStore((state) => state.saveActiveFile);
  const openSearch = useUiStore((state) => state.openSearch);

  useSaveOnExit();

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    void loadActiveWorkspaceFiles();
  }, [activeWorkspaceId, loadActiveWorkspaceFiles]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    subscribeToWorkspaceFs(activeWorkspaceId, (event) => {
      void handleFsEvent(activeWorkspaceId, event);
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
        } else {
          unsubscribe = unlisten;
        }
      })
      .catch(() => {
        // ignore — fs events are best-effort
      });

    return () => {
      cancelled = true;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [activeWorkspaceId, handleFsEvent]);

  // Compensating refresh on window focus (VS Code does the same): whatever a
  // watcher gap missed while the app was in the background gets reconciled the
  // moment the user comes back. Storm-guarded + min-interval in the store, so
  // cmd-tabbing around doesn't re-walk the vault.
  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    function onFocus() {
      void refreshWorkspaceTree(activeWorkspaceId ?? undefined);
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [activeWorkspaceId, refreshWorkspaceTree]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.shiftKey && !event.altKey && event.key === "s") {
        event.preventDefault();
        void saveActiveFile();
        return;
      }
      // ⌘⇧F (Ctrl+Shift+F) opens workspace file search — ⌘S is save, ⌘P is print.
      if (mod && event.shiftKey && !event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        openSearch();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveActiveFile, openSearch]);

  // Render the shell immediately — the active workspace's file scan runs in the
  // background (loadActiveWorkspaceFiles above) and streams into the file tree,
  // which shows its own loading state. Gating the whole app on the scan made a
  // large iCloud vault wait seconds at launch (and stick if the scan stalled).
  return <AppShell />;
}
