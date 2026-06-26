import { memo, useEffect, useRef } from "react";
import { Close, Document } from "@carbon/react/icons";
import { PanelLeft } from "lucide-react";
import type { WorkspaceFileEntry } from "../file-tree/fileTreeTypes";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { useWindowDrag } from "../../lib/runtime/useWindowDrag";
import { markTabSwitchStart } from "../../lib/perf";

/** A file tab: just the workspace file entry. The dirty flag is deliberately
 * NOT here — it's read per-tab by {@link TabDirtyDot}, so a dirty flip (first
 * edit / autosave) re-renders only that one dot, not the whole strip. That
 * keeps the `files` array reference stable across edits and saves. */
export interface EditorTab {
  entry: WorkspaceFileEntry;
}

/**
 * The unsaved-edit dot for one tab. Self-subscribes to just that file's dirty
 * flag (a boolean), so the dirty flip on first-edit / autosave re-renders ONLY
 * this dot — never the tab strip.
 */
function TabDirtyDot({ path }: { path: string }) {
  const dirty = useWorkspaceStore((state) => {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    return Boolean(ws?.fileContents[path]?.dirty);
  });
  return dirty ? <span className="dirty-dot" aria-label="Unsaved" /> : null;
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
  const hasShow = Boolean(onShowSidebar);
  const onStripMouseDown = useWindowDrag();

  // Keep the active tab in view when it changes or a tab is added — opening a
  // file from search / the file tree appends a tab off-screen to the right, so
  // the strip must scroll to reveal it. Keyed on the active path + tab count;
  // the strip only re-renders on tab open/close/active-change (never per
  // keystroke), so the effect stays off the editing hot path.
  const activeTabRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeFilePath, files.length]);

  if (files.length === 0 && !hasShow) {
    return null;
  }

  // The whole strip is a drag region so the empty space between tabs (and
  // the trailing area after the last tab) drags the window — matches the
  // macOS expectation of "any empty title-bar area drags the window". The
  // `mousedown` handler calls `startDragging()`; it auto-ignores clicks on
  // any descendant `<button>`, so the tab + close buttons keep working.
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
        {files.map(({ entry }) => {
          const active = entry.relativePath === activeFilePath;
          const slash = entry.relativePath.lastIndexOf("/");
          const fileName = slash >= 0 ? entry.relativePath.slice(slash + 1) : entry.relativePath;

          return (
            <div
              key={`file:${entry.relativePath}`}
              ref={active ? activeTabRef : undefined}
              className={["editor-tab", active ? "editor-tab--active" : ""]
                .filter(Boolean)
                .join(" ")}
              title={entry.relativePath}
              data-tauri-drag-region="false"
            >
              <button
                type="button"
                role="tab"
                aria-selected={active}
                className="tab-button"
                data-tauri-drag-region="false"
                onClick={() => {
                  markTabSwitchStart();
                  onSelectFile(entry.relativePath);
                }}
              >
                <Document size={14} />
                <span className="truncate">{fileName}</span>
                <TabDirtyDot path={entry.relativePath} />
              </button>
              <button
                type="button"
                aria-label={`Close ${entry.relativePath}`}
                title={`Close ${fileName}`}
                className="tab-close"
                data-tauri-drag-region="false"
                onClick={() => onCloseFile(entry.relativePath)}
              >
                <Close size={14} />
              </button>
            </div>
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
