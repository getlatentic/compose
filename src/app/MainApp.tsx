import { useEffect } from "react";
import { subscribeToWorkspaceFs } from "../lib/ipc/fileWatcherClient";
import { SplashScreen } from "./SplashScreen";
import { AppShell } from "./AppShell";
import { useWorkspaceStore } from "./workspaceStore";

/**
 * The main app screen (mounted by AppRouter once boot + onboarding are done).
 * Owns the workspace-level effects (file scan, fs-watch, ⌘S, unsaved-warning)
 * and the initial-scan gate. Subscribes to only `activeWorkspaceId` and the
 * active workspace's `scanState` — both change on workspace switch / scan
 * completion, never on a keystroke — so the document churn lives entirely in
 * the leaf regions under AppShell, not here.
 */
export function MainApp() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const handleFsEvent = useWorkspaceStore((state) => state.handleFsEvent);
  const loadActiveWorkspaceFiles = useWorkspaceStore((state) => state.loadActiveWorkspaceFiles);
  const saveActiveFile = useWorkspaceStore((state) => state.saveActiveFile);
  // Primitive selector: re-renders only when the active workspace's scan state
  // changes (or the active workspace switches) — not on content edits.
  const scanState = useWorkspaceStore((state) => {
    const ws = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
    return ws?.scanState ?? null;
  });

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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isSaveShortcut =
        (event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key === "s";
      if (!isSaveShortcut) {
        return;
      }
      event.preventDefault();
      void saveActiveFile();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveActiveFile]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      const hasDirty = useWorkspaceStore
        .getState()
        .workspaces.some((workspace) =>
          Object.values(workspace.fileContents).some((buffer) => buffer.dirty),
        );
      if (!hasDirty) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // This screen only mounts once boot + onboarding are done (see AppRouter), so
  // the remaining wait is the active workspace's initial file scan. Hold the
  // single loader (not an "empty workspace" flash) until it terminates. A
  // failed scan surfaces its error in-pane, so it counts as resolved.
  if (scanState && scanState !== "ready" && scanState !== "failed") {
    return <SplashScreen />;
  }

  return <AppShell />;
}
