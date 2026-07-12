import { memo, useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { Close, Document } from "@carbon/react/icons";
import { PanelLeft } from "lucide-react";
import type { WorkspaceFileEntry } from "../file-tree/fileTreeTypes";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { selectLooseWorkspace } from "../../app/store/activeWorkspace";
import { useWindowDrag } from "../../lib/runtime/useWindowDrag";
import { markTabSwitchStart } from "../../lib/perf";

/** dataTransfer MIME for a tab dragged to reorder it (#29). */
const TAB_DRAG_MIME = "application/x-compose-tab-path";
/** The path + area of the tab being dragged, tracked out-of-band because WebKit
 *  hides a custom dataTransfer type during `dragover` (see the file-tree drag
 *  notes). Reordering stays within one area — workspace tabs and external tabs
 *  don't interleave. */
let draggedTabPath: string | null = null;
let draggedTabArea: TabArea | null = null;

/** Which container a tab's file lives in: the active workspace, or the loose
 *  pseudo-workspace of external files (#113). */
export type TabArea = "workspace" | "loose";

/** A file tab: the file entry plus its container. The dirty flag is deliberately
 * NOT here — it's read per-tab by {@link TabDirtyDot}, so a dirty flip (first
 * edit / autosave) re-renders only that one dot, not the whole strip. That
 * keeps the `files` array reference stable across edits and saves. */
export interface EditorTab {
  entry: WorkspaceFileEntry;
  area: TabArea;
}

/**
 * The unsaved-edit dot for one tab. Self-subscribes to just that file's dirty
 * flag (a boolean), so the dirty flip on first-edit / autosave re-renders ONLY
 * this dot — never the tab strip.
 */
function TabDirtyDot({ path, area }: { path: string; area: TabArea }) {
  const dirty = useWorkspaceStore((state) => {
    const ws =
      area === "loose"
        ? selectLooseWorkspace(state)
        : state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    return Boolean(ws?.fileContents[path]?.dirty);
  });
  return dirty ? <span className="dirty-dot" aria-label="Unsaved" /> : null;
}

/**
 * One editor tab, memoised. Draggable to reorder (#29): `data-no-drag` stops the
 * strip's window-drag from stealing the mousedown, and the dragged path is
 * tracked in a module variable (WebKit doesn't expose the custom dataTransfer
 * type during `dragover`). The active tab registers its element so the strip can
 * scroll it into view.
 */
const EditorTabItem = memo(function EditorTabItem({
  path,
  area,
  fileName,
  active,
  onSelect,
  onClose,
  onReorder,
  registerActiveEl,
}: {
  path: string;
  area: TabArea;
  fileName: string;
  active: boolean;
  onSelect: (path: string, area: TabArea) => void;
  onClose: (path: string, area: TabArea) => void;
  onReorder: (fromPath: string, toPath: string, area: TabArea) => void;
  registerActiveEl: (el: HTMLDivElement | null) => void;
}) {
  const [dropTarget, setDropTarget] = useState(false);
  const onDragStart = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.dataTransfer.setData(TAB_DRAG_MIME, path);
      event.dataTransfer.effectAllowed = "move";
      draggedTabPath = path;
      draggedTabArea = area;
    },
    [path, area],
  );
  const onDragEnd = useCallback(() => {
    draggedTabPath = null;
    draggedTabArea = null;
  }, []);
  const onDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (draggedTabPath === null || draggedTabPath === path || draggedTabArea !== area) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(true);
    },
    [path, area],
  );
  const onDragLeave = useCallback(() => setDropTarget(false), []);
  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDropTarget(false);
      const from = draggedTabPath ?? event.dataTransfer.getData(TAB_DRAG_MIME);
      const fromArea = draggedTabArea;
      draggedTabPath = null;
      draggedTabArea = null;
      if (from && fromArea === area) {
        onReorder(from, path, area);
      }
    },
    [path, area, onReorder],
  );
  const onSelectClick = useCallback(() => {
    markTabSwitchStart();
    onSelect(path, area);
  }, [onSelect, path, area]);
  const onCloseClick = useCallback(() => onClose(path, area), [onClose, path, area]);

  return (
    <div
      ref={active ? registerActiveEl : undefined}
      className={[
        "editor-tab",
        active ? "editor-tab--active" : "",
        dropTarget ? "editor-tab--drop" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      title={path}
      data-tauri-drag-region="false"
      data-no-drag
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className="tab-button"
        data-tauri-drag-region="false"
        onClick={onSelectClick}
      >
        <Document size={14} />
        <span className="truncate">{fileName}</span>
        <TabDirtyDot path={path} area={area} />
      </button>
      <button
        type="button"
        aria-label={`Close ${path}`}
        title={`Close ${fileName}`}
        className="tab-close"
        data-tauri-drag-region="false"
        onClick={onCloseClick}
      >
        <Close size={14} />
      </button>
    </div>
  );
});

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
  activeArea,
  onSelectFile,
  onCloseFile,
  onReorderTab,
  leadingInsetPx,
  onShowSidebar,
}: {
  files: EditorTab[];
  activeFilePath: string;
  /** Which container the active path belongs to — an external file and a
   *  workspace file could otherwise never disambiguate. */
  activeArea: TabArea;
  onSelectFile: (path: string, area: TabArea) => void;
  onCloseFile: (path: string, area: TabArea) => void;
  onReorderTab: (fromPath: string, toPath: string, area: TabArea) => void;
  /** When set, prepend a non-interactive draggable spacer of this width — used
   * to clear the macOS traffic lights when the sidebar is collapsed. */
  leadingInsetPx?: number;
  /** When set, render a small PanelLeft button next to the inset that re-opens
   * the sidebar (visible only when collapsed). */
  onShowSidebar?: () => void;
}) {
  const hasShow = Boolean(onShowSidebar);
  const onStripMouseDown = useWindowDrag();

  // Keep the active tab in view when it changes or a tab is added — opening a
  // file from search / the file tree appends a tab off-screen to the right, so
  // the strip must scroll to reveal it. The active tab registers its element
  // here; the strip only re-renders on tab open/close/active-change (never per
  // keystroke), so the effect stays off the editing hot path.
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  const registerActiveEl = useCallback((el: HTMLDivElement | null) => {
    activeTabRef.current = el;
  }, []);
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeFilePath, activeArea, files.length]);

  if (files.length === 0 && !hasShow) {
    return null;
  }

  // The whole strip is a drag region so the empty space between tabs (and
  // the trailing area after the last tab) drags the window — matches the
  // macOS expectation of "any empty title-bar area drags the window". The
  // `mousedown` handler calls `startDragging()`; it ignores `data-no-drag`
  // descendants, so the tab buttons and the draggable tabs keep working.
  return (
    <div className="tab-strip" data-tauri-drag-region onMouseDown={onStripMouseDown}>
      {onShowSidebar ? (
        // Collapsed: reuse the sidebar titlebar's styling so the toggle sits
        // exactly where it does with the sidebar open (aligned with the traffic
        // lights), and the tabs don't shift. `--traffic-lights-inset` reserves
        // the macOS lights' home, matching the expanded titlebar.
        <div
          className="sidebar-titlebar tab-strip__lead"
          data-tauri-drag-region
          style={{ ["--traffic-lights-inset" as never]: `${leadingInsetPx}px` }}
        >
          <button
            type="button"
            className="sidebar-titlebar__btn"
            data-tauri-drag-region="false"
            onClick={onShowSidebar}
            aria-label="Show sidebar"
            title="Show sidebar"
          >
            <PanelLeft size={16} aria-hidden />
          </button>
        </div>
      ) : null}
      {/* Only the tabs scroll. The traffic-light spacer + show-sidebar toggle
          are siblings of this scroller, so they stay pinned at the start and
          never slide under the macOS window controls when tabs overflow. */}
      <div
        className="tab-strip__scroll"
        role="tablist"
        aria-label="Open tabs"
        data-tauri-drag-region
      >
        {files.map(({ entry, area }) => {
          const active = area === activeArea && entry.relativePath === activeFilePath;
          const slash = entry.relativePath.lastIndexOf("/");
          const fileName = slash >= 0 ? entry.relativePath.slice(slash + 1) : entry.relativePath;

          return (
            <EditorTabItem
              key={`${area}:${entry.relativePath}`}
              path={entry.relativePath}
              area={area}
              fileName={fileName}
              active={active}
              onSelect={onSelectFile}
              onClose={onCloseFile}
              onReorder={onReorderTab}
              registerActiveEl={registerActiveEl}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Memoized: the strip re-renders only when a tab opens/closes or the active
 * file changes — never on edits, saves, or dirty flips (those update the
 * per-tab {@link TabDirtyDot} in isolation).
 */
export const PaneTabs = memo(PaneTabsInner);
