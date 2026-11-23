import { useMemo } from "react";
import { useWorkspaceStore } from "../../app/workspaceStore";
import {
  parseFrontmatter,
  serializeMarkdown,
  type Frontmatter,
} from "@latentic/live-markdown";
import { PropertiesPanel } from "./PropertiesPanel";
import type { Workspace } from "../../app/workspaceModel";

/**
 * The ACTIVE FILE's frontmatter (Properties), self-subscribing: it re-renders
 * on its own narrow data, never on a body keystroke. Shown in the editor's
 * Properties popover (`editor/PropertiesButton.tsx`).
 */

function activeWorkspace(state: { workspaces: Workspace[]; activeWorkspaceId: string | null }) {
  return state.workspaces.find((w) => w.id === state.activeWorkspaceId) ?? null;
}

function activeContent(ws: Workspace | null): string {
  if (!ws?.activeFilePath) return "";
  return ws.fileContents[ws.activeFilePath]?.content ?? "";
}

// ── Properties (frontmatter) ───────────────────────────────────────────────

/**
 * The active file's parsed frontmatter, with a STABLE identity across body
 * edits. We subscribe to a JSON key of the frontmatter (a primitive — so the
 * component only re-renders when the frontmatter itself changes, never on a
 * body keystroke), then re-parse the live content once per change to recover
 * the real object (the JSON key is lossy, used only for change detection).
 */
function useActiveFileFrontmatter(): Frontmatter | null {
  const key = useWorkspaceStore((state) =>
    JSON.stringify(parseFrontmatter(activeContent(activeWorkspace(state))).frontmatter ?? null),
  );
  return useMemo(() => {
    const state = useWorkspaceStore.getState();
    return parseFrontmatter(activeContent(activeWorkspace(state))).frontmatter;
  }, [key]);
}

/** How many fields the active file's frontmatter has; re-renders only when that changes. */
export function useActiveFileFieldCount(): number {
  return useWorkspaceStore((state) => Object.keys(parseFrontmatter(activeContent(activeWorkspace(state))).frontmatter ?? {}).length);
}

/** Whether the workspace's active file is the one the editor shows, so its properties can be edited. */
export function useCanEditActiveFileProperties(): boolean {
  const hasActiveFile = useWorkspaceStore((state) => Boolean(activeWorkspace(state)?.activeFilePath));
  const editorElsewhere = useWorkspaceStore((state) => state.focusedArea === "loose");
  return hasActiveFile && !editorElsewhere;
}

export function ActiveFileProperties() {
  const frontmatter = useActiveFileFrontmatter();
  // While an external file is focused the editor shows a DIFFERENT document
  // than this workspace-scoped panel, and `updateActiveContent` writes to the
  // focused one, so a commit here would cross-write into it.
  if (!useCanEditActiveFileProperties()) {
    return null;
  }
  const commit = (next: Frontmatter | null) => {
    // Re-serialize with the LIVE body (read at commit time, not closed over) so
    // a frontmatter edit never clobbers concurrent body edits.
    const state = useWorkspaceStore.getState();
    const { body } = parseFrontmatter(activeContent(activeWorkspace(state)));
    state.updateActiveContent(serializeMarkdown({ frontmatter: next, body }));
  };
  return <PropertiesPanel frontmatter={frontmatter} onCommitFrontmatter={commit} />;
}
