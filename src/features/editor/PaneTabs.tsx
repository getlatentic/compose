import { memo, type ReactNode } from "react";
import { Close, Document, Globe, Settings, Terminal } from "@carbon/react/icons";
import type { WorkspaceFileBuffer, WorkspaceFileEntry } from "../file-tree/fileTreeTypes";
import type { WorkspacePane, WorkspacePaneKind } from "../../app/workspaceModel";

/** A file tab: a workspace file plus its (maybe-unloaded) buffer. */
export interface EditorTab {
  entry: WorkspaceFileEntry;
  buffer: WorkspaceFileBuffer | null;
}

function paneIcon(kind: WorkspacePaneKind): ReactNode {
  switch (kind) {
    case "settings":
      return <Settings size={14} />;
    case "terminal":
      return <Terminal size={14} />;
    case "browser":
      return <Globe size={14} />;
  }
}

/**
 * The editor tab strip — a VSCode-style row that hosts heterogeneous
 * panes. File tabs come first (one per open file), then non-file panes
 * (Settings today; terminal / browser later). Exactly one tab is active:
 * a non-file pane when `activePaneId` is set, otherwise the active file.
 */
function PaneTabsInner({
  files,
  activeFilePath,
  activePaneId,
  panes,
  onSelectFile,
  onCloseFile,
  onSelectPane,
  onClosePane,
}: {
  files: EditorTab[];
  activeFilePath: string;
  activePaneId: string | null;
  panes: WorkspacePane[];
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  onSelectPane: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
}) {
  if (files.length === 0 && panes.length === 0) {
    return null;
  }

  return (
    <div className="bob-tab-strip" role="tablist" aria-label="Open tabs">
      {files.map(({ entry, buffer }) => {
        const active = activePaneId === null && entry.relativePath === activeFilePath;
        const slash = entry.relativePath.lastIndexOf("/");
        const fileName = slash >= 0 ? entry.relativePath.slice(slash + 1) : entry.relativePath;

        return (
          <div
            key={`file:${entry.relativePath}`}
            className={["bob-editor-tab", active ? "bob-editor-tab--active" : ""]
              .filter(Boolean)
              .join(" ")}
            title={entry.relativePath}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="bob-tab-button"
              onClick={() => onSelectFile(entry.relativePath)}
            >
              <Document size={14} />
              <span className="truncate">{fileName}</span>
              {buffer?.dirty ? <span className="bob-dirty-dot" aria-label="Unsaved" /> : null}
            </button>
            <button
              type="button"
              aria-label={`Close ${entry.relativePath}`}
              title={`Close ${fileName}`}
              className="bob-tab-close"
              onClick={() => onCloseFile(entry.relativePath)}
            >
              <Close size={14} />
            </button>
          </div>
        );
      })}

      {panes.map((pane) => {
        const active = pane.id === activePaneId;
        return (
          <div
            key={`pane:${pane.id}`}
            className={["bob-editor-tab", active ? "bob-editor-tab--active" : ""]
              .filter(Boolean)
              .join(" ")}
            title={pane.title}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              className="bob-tab-button"
              onClick={() => onSelectPane(pane.id)}
            >
              {paneIcon(pane.kind)}
              <span className="truncate">{pane.title}</span>
            </button>
            <button
              type="button"
              aria-label={`Close ${pane.title}`}
              title={`Close ${pane.title}`}
              className="bob-tab-close"
              onClick={() => onClosePane(pane.id)}
            >
              <Close size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Memoized: the strip only changes when files/panes open, close, become
 * dirty, or the active tab changes — never during chat streaming or
 * per-keystroke edits.
 */
export const PaneTabs = memo(PaneTabsInner);
