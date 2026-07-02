import { isTauriRuntime } from "../runtime/desktopRuntime";

/**
 * `created`/`modified`/`removed` describe one path. `rescan` is a tree-wide
 * control signal (the watcher lost sync — overflow, or a gap while
 * re-establishing) asking for one full reconciling scan. `watch-error` means
 * watching gave up entirely (bounded restarts exhausted).
 */
export type WorkspaceFsEventKind = "created" | "modified" | "removed" | "rescan" | "watch-error";

export interface WorkspaceFsEvent {
  kind: WorkspaceFsEventKind;
  lastModifiedMs: number | null;
  relativePath: string;
  workspaceId: string;
  /** Known for `created` (stat'd at emit time); absent for `removed`. */
  isDir?: boolean | null;
  /** File size at emit time, for building a tree entry without a rescan. */
  sizeBytes?: number | null;
}

const WORKSPACE_FS_EVENT = "workspace_fs";

export async function subscribeToWorkspaceFs(
  workspaceId: string,
  handler: (event: WorkspaceFsEvent) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => {};
  }

  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<WorkspaceFsEvent>(WORKSPACE_FS_EVENT, (event) => {
    if (event.payload.workspaceId === workspaceId) {
      handler(event.payload);
    }
  });
  return unlisten;
}
