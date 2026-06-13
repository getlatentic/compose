import { memo } from "react";
import { Close, Document } from "@carbon/react/icons";
import { PanelLeft } from "lucide-react";
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
 *
 * When the sidebar is collapsed, the strip also hosts the macOS traffic-lights
 * inset (`leadingInsetPx`) and a "show sidebar" affordance — that's how the
 * user gets the sidebar back once they hid it. Otherwise both are absent and
 * the strip flows from its left edge as before.
 */
function PaneTabsInner({
  files,
  activeFilePath,
  onSelectFile,
  onCloseFile,
  leadingInsetPx,
  onShowSidebar,
}: {
  files: EditorTab[];
  activeFilePath: string;
  onSelectFile: (path: string) => void;
  onCloseFile: (path: string) => void;
  /** When set, prepend a non-interactive draggable spacer of this width — used
   * to clear the macOS traffic lights when the sidebar is collapsed. */
  leadingInsetPx?: number;
  /** When set, render a small PanelLeft button next to the inset that re-opens
   * the sidebar (visible only when collapsed). */
  onShowSidebar?: () => void;
}) {
  const hasInset = (leadingInsetPx ?? 0) > 0;
  const hasShow = Boolean(onShowSidebar);
  if (files.length === 0 && !hasInset && !hasShow) {
    return null;
  }

  return (
    <div className="bob-tab-strip" role="tablist" aria-label="Open tabs">
      {hasInset ? (
        <div
          className="bob-tab-strip__traffic-spacer"
          data-tauri-drag-region
          style={{ width: `${leadingInsetPx}px` }}
          aria-hidden
        />
      ) : null}
      {onShowSidebar ? (
        <button
          type="button"
          className="bob-tab-strip__sidebar-toggle"
          onClick={onShowSidebar}
          aria-label="Show sidebar"
          title="Show sidebar"
        >
          <PanelLeft size={16} aria-hidden />
        </button>
      ) : null}
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
