import { isTauriRuntime } from "../runtime/desktopRuntime";

export type WorkspaceFsEventKind = "created" | "modified" | "removed";

export interface WorkspaceFsEvent {
  kind: WorkspaceFsEventKind;
  lastModifiedMs: number | null;
  relativePath: string;
  workspaceId: string;
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
