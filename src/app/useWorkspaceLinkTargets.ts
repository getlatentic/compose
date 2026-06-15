import { useMemo } from "react";
import { useWorkspaceStore } from "./workspaceStore";

/**
 * The set of workspace file paths a `[text](path)` markdown link can resolve
 * to. Subscribes through a **string key** of the file list, so it only
 * recomputes when files are added/removed — never on content edits. Shared by
 * the editor (modifier-click navigation) and chat (click navigation).
 */
export function useWorkspaceLinkTargets(): Set<string> {
  const key = useWorkspaceStore((state) => {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    return ws ? ws.files.map((f) => f.relativePath).join("\n") : "";
  });
  return useMemo(() => new Set(key ? key.split("\n") : []), [key]);
}
