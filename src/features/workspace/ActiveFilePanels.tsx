import { useMemo } from "react";
import { useWorkspaceStore } from "../../app/workspaceStore";
import {
  parseFrontmatter,
  serializeMarkdown,
  type Frontmatter,
} from "ai-editor";
import { PropertiesPanel } from "./PropertiesPanel";
import type { Workspace } from "../../app/workspaceModel";

/**
 * Self-subscribing sidebar panel for the ACTIVE FILE's frontmatter
 * (Properties). Split out of `FilesTab` so it re-renders on its own narrow data
 * instead of dragging the file list with it: editing the body churns the buffer
 * + (on autosave) the workspace index, and the old structure passed both into
 * the files pane, re-rendering `<FileTree>` on every keystroke. This panel
 * subscribes to a STABLE projection, so the file list no longer re-renders when
 * you type.
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

export function ActiveFileProperties() {
  const frontmatter = useActiveFileFrontmatter();
  const hasActiveFile = useWorkspaceStore((state) => Boolean(activeWorkspace(state)?.activeFilePath));
  // While an external file is focused (#113) the editor shows a DIFFERENT
  // document than this workspace-scoped panel — and `updateActiveContent`
  // writes to the focused one, so a commit here would cross-write into it.
  const editorElsewhere = useWorkspaceStore((state) => state.focusedArea === "loose");
  if (!hasActiveFile || editorElsewhere) {
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
