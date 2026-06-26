import { useMemo, useRef } from "react";
import { useWorkspaceStore } from "../../app/workspaceStore";
import {
  parseFrontmatter,
  serializeMarkdown,
  type Frontmatter,
} from "ai-editor";
import { PropertiesPanel } from "./PropertiesPanel";
import type { Workspace } from "../../app/workspaceModel";
import type { WorkspaceBacklinkRecord, WorkspaceIndexSnapshot } from "../../lib/ipc/indexClient";
import { useIndexStore } from "../../app/store/indexStore";

/**
 * Self-subscribing sidebar panels for the ACTIVE FILE — its frontmatter
 * (Properties) and its backlinks. Split out of `FilesTab` so they re-render on
 * their own narrow data instead of dragging the file list with them: editing
 * the body churns the buffer + (on autosave) the workspace index, and the old
 * structure passed both into the files pane, re-rendering `<FileTree>` on every
 * keystroke. Each panel here subscribes to a STABLE projection, so the file
 * list no longer re-renders when you type.
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
  if (!hasActiveFile) {
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

// ── Backlinks ──────────────────────────────────────────────────────────────

function computeBacklinks(
  snapshot: WorkspaceIndexSnapshot | null,
  activeFilePath: string | null,
): WorkspaceBacklinkRecord[] {
  if (!activeFilePath || !snapshot) {
    return [];
  }
  const activeDocument = snapshot.documents.find((document) => document.path === activeFilePath);
  return snapshot.backlinks.filter((backlink) => {
    if (activeDocument && backlink.targetDocId === activeDocument.docId) {
      return true;
    }
    return backlink.targetPath === activeFilePath;
  });
}

function backlinkKey(records: WorkspaceBacklinkRecord[]): string {
  return records.map((b) => `${b.sourceDocId}:${b.sourceRange.start}`).join("|");
}

/**
 * The active file's backlinks, read from the dedicated index store — so the
 * autosave index rebuild re-renders only this, not the file tree — with a
 * STABLE reference when the result is structurally unchanged.
 */
function useActiveFileBacklinks(): WorkspaceBacklinkRecord[] {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const activeFilePath = useWorkspaceStore((state) => activeWorkspace(state)?.activeFilePath ?? null);
  const snapshot = useIndexStore((state) =>
    activeWorkspaceId ? state.byWorkspace[activeWorkspaceId]?.snapshot ?? null : null,
  );
  const computed = useMemo(
    () => computeBacklinks(snapshot, activeFilePath),
    [snapshot, activeFilePath],
  );
  const ref = useRef<WorkspaceBacklinkRecord[]>(computed);
  if (backlinkKey(computed) !== backlinkKey(ref.current)) {
    ref.current = computed;
  }
  return ref.current;
}

export function ActiveFileBacklinks() {
  const backlinks = useActiveFileBacklinks();
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  if (backlinks.length === 0) {
    return null;
  }
  return (
    <div className="backlinks" aria-label="Backlinks">
      <div className="section-label section-label--compact">
        <span>Backlinks</span>
        <span className="section-meta">{backlinks.length}</span>
      </div>
      {backlinks.slice(0, 6).map((backlink) => (
        <button
          type="button"
          key={`${backlink.sourceDocId}:${backlink.sourceRange.start}`}
          className="backlink"
          onClick={() => void selectFile(backlink.sourcePath)}
        >
          <span className="backlink__path">{backlink.sourcePath}</span>
          <span className="backlink__label">{backlink.label}</span>
        </button>
      ))}
    </div>
  );
}
