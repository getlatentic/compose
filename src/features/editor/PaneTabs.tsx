import { memo } from "react";
import { Close, Document } from "@carbon/react/icons";
import type { WorkspaceFileBuffer, WorkspaceFileEntry } from "../file-tree/fileTreeTypes";

/** A file tab: a workspace file plus its (maybe-unloaded) buffer. */
export interface EditorTab {
  entry: WorkspaceFileEntry;
  buffer: WorkspaceFileBuffer | null;
}

/**
 * The editor tab strip — a VSCode-style row of open file tabs. Exactly one tab
 * is active (the active file). Settings and other app surfaces are modals /
 * panels, not tabs, so this strip holds only files.
 */
function PaneTabsInner({
  files,
  activeFilePath,
  onSelectFile,
  onCloseFile,
}: {
  files: EditorTab[];
  activeFilePath: string;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
}) {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className="bob-tab-strip" role="tablist" aria-label="Open tabs">
      {files.map(({ entry, buffer }) => {
        const active = entry.relativePath === activeFilePath;
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
    </div>
  );
}

/**
 * Memoized: the strip only changes when files open, close, become dirty, or
 * the active file changes — never during chat streaming or per-keystroke edits.
 */
export const PaneTabs = memo(PaneTabsInner);
