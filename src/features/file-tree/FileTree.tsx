import { useMemo, useCallback, useRef, useEffect, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { WorkspaceFileEntry } from "./fileTreeTypes";
import { buildTree, ancestorFolders, flatten, rowKey } from "./treeModel";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { type RowMenuHandlers, useRowMenu, RowMenuList } from "./RowMenu";
import { useUiStore } from "../../app/store/uiStore";
import { remInPx } from "../../lib/zoom/zoom";
import { readTreeScroll, persistTreeScroll } from "./treeScroll";
import { useTreeActions } from "./useTreeActions";
import { useExpandedFolders, useRevealRow } from "./useTreeExpansion";
import { FolderRow, FileRow } from "./TreeRows";

/** A row's slot: `.file-row-wrapper`'s 2rem plus the 2px gap, in rem
 * (`_file-tree.scss`). The virtualizer places rows by it without measuring each. */
const ROW_HEIGHT_REM = 2.125;

function FileTreeInner({
  activePath,
  files,
  folders,
  onDelete,
  onRename,
  onMoveFile,
  onSelectFile,
}: {
  activePath: string;
  files: WorkspaceFileEntry[];
  folders: string[];
  onDelete: (relativePath: string) => void;
  onRename: (relativePath: string) => void;
  onMoveFile: (fromPath: string, folderPath: string) => void;
  onSelectFile: (relativePath: string) => void;
}) {
  const tree = useMemo(() => buildTree(files, folders), [files, folders]);
  // The active workspace's scan runs in the background (MainApp no longer gates
  // the app on it), so an empty tree means "still scanning", not "no notes".
  const scanning = useWorkspaceStore((state) => {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    return ws ? ws.scanState !== "ready" && ws.scanState !== "failed" : false;
  });
  // A scan that FAILED (root unreadable — e.g. iCloud not materialized yet) is
  // distinct from an empty vault: the tree offers a Retry instead of the
  // misleading "No notes yet". Boot auto-retries with backoff; this is the
  // manual escape hatch once that gives up.
  const scanFailed = useWorkspaceStore((state) => {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    return ws?.scanState === "failed";
  });
  const retryScan = useWorkspaceStore((state) => state.loadActiveWorkspaceFiles);
  // Call with no args so the click event isn't passed as the retry `attempt`.
  const handleRetry = useCallback(() => void retryScan(), [retryScan]);
  const workspaceRoot = useWorkspaceStore((state) => {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    return ws?.path ?? "";
  });
  const { expanded, setExpanded, toggleFolder } = useExpandedFolders(tree, workspaceRoot, activePath);
  const rows = useMemo(() => flatten(tree, expanded), [tree, expanded]);
  // The folder a plain "New note" lands in. A string that changes only on a
  // deliberate select, so subscribing here re-renders the tree (and the two
  // folder rows whose `selected` flips) without touching the editing hot path.
  const newNoteDir = useWorkspaceStore((state) => state.newNoteDir);
  const { copyPath, revealInFinder, activateFolder, newNoteHere, newFolderHere, handleDeleteFolder, selectFileTrackingDir } =
    useTreeActions({ workspaceRoot, toggleFolder, onSelectFile });

  const rowMenuHandlers = useMemo<RowMenuHandlers>(
    () => ({
      rename: onRename,
      copyPath,
      reveal: revealInFinder,
      deleteFile: onDelete,
      newNoteHere,
      newFolderHere,
      deleteFolder: handleDeleteFolder,
    }),
    [onRename, copyPath, revealInFinder, onDelete, newNoteHere, newFolderHere, handleDeleteFolder],
  );
  const { openRowMenu, openMenu, closeRowMenu } = useRowMenu(rowMenuHandlers);

  // Window the (already collapse-flattened) rows: only ~a viewport-worth mount,
  // regardless of vault size. `rows` already excludes descendants of collapsed
  // folders, so the count is exactly the currently-visible rows. Fixed row
  // height means no per-row measurement.
  const scrollRef = useRef<HTMLElement>(null);
  const zoom = useUiStore((state) => state.zoom);
  // Read again when the zoom changes the root size.
  const rowHeight = useMemo(() => ROW_HEIGHT_REM * remInPx(zoom), [zoom]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    getItemKey: (index) => rowKey(rows[index]),
    // Without an initial rect the first render sizes its window against a
    // height of zero and fills the rest in once the element is measured — rows
    // appearing under the reader a beat after the launch drew them. The tree
    // can never be taller than the window, so that is the estimate: too many
    // rows render below the fold for one frame, where nobody can see them, and
    // are trimmed on measurement.
    initialRect: { width: 0, height: typeof window === "undefined" ? 0 : window.innerHeight },
    // Start where the tree was left. The reveal below scrolls to the open file
    // in a passive effect — after the paint — and that scroll is the sidebar
    // jump. Last session's offset already has that file in view, so restoring
    // it makes the first frame right and leaves the reveal nothing to do.
    initialOffset: () => readTreeScroll(workspaceRoot),
    onChange: (instance) => persistTreeScroll(workspaceRoot, instance.scrollOffset ?? 0),
  });
  // Rows are sized in rem, so zoom resizes them; the slots have to follow.
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowHeight]);

  useRevealRow({ path: activePath, type: "file", folders: ancestorFolders(activePath) }, rows, virtualizer, setExpanded);
  // The folder a new note goes in, as when "New folder" has just made it.
  useRevealRow(
    { path: newNoteDir, type: "folder", folders: newNoteDir ? ancestorFolders(`${newNoteDir}/_`) : [] },
    rows,
    virtualizer,
    setExpanded,
  );

  if (files.length === 0) {
    return <EmptyTree scanning={scanning} scanFailed={scanFailed} onRetry={handleRetry} />;
  }

  return (
    <nav ref={scrollRef} className="file-tree" aria-label="Files">
      <div className="file-tree__sizer" style={{ blockSize: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const node = rows[item.index];
          return (
            <div
              key={item.key}
              className="file-tree__row"
              style={{ blockSize: item.size, transform: `translateY(${item.start}px)` }}
            >
              {node.type === "folder" ? (
                <FolderRow
                  path={node.path}
                  name={node.name}
                  depth={node.depth}
                  open={expanded.has(node.path)}
                  selected={node.path === newNoteDir}
                  onActivate={activateFolder}
                  onMenu={openRowMenu}
                  onMoveHere={onMoveFile}
                />
              ) : (
                <FileRow
                  path={node.path}
                  name={node.name}
                  depth={node.depth}
                  active={node.path === activePath}
                  onSelect={selectFileTrackingDir}
                  onMenu={openRowMenu}
                  onMoveHere={onMoveFile}
                />
              )}
            </div>
          );
        })}
      </div>
      {openMenu ? <RowMenuList menu={openMenu} onClose={closeRowMenu} /> : null}
    </nav>
  );
}

interface EmptyTreeProps {
  readonly scanning: boolean;
  readonly scanFailed: boolean;
  readonly onRetry: () => void;
}

/** No rows yet: still reading the folder, unable to read it, or no notes. */
function EmptyTree({ scanning, scanFailed, onRetry }: EmptyTreeProps) {
  return (
    <div className="file-tree file-tree--empty">
      {scanning ? (
        <p>Loading notes…</p>
      ) : scanFailed ? (
        <>
          <p>Couldn't read your vault</p>
          <p>It may still be syncing (iCloud) — your notes are safe.</p>
          <button type="button" className="file-tree__retry" onClick={onRetry}>
            Retry
          </button>
        </>
      ) : (
        <>
          <p>No notes yet</p>
          <p>Create a note or open a folder to get started.</p>
        </>
      )}
    </div>
  );
}

/**
 * Memoized export. FileTree's incoming `files` array gets a
 * new reference every time the workspace store mutates (chat
 * tokens, fs events, autosaves), but the file LIST itself
 * rarely changes during those events. Memo means the tree
 * doesn't re-render unless its actual contents shift.
 */
export const FileTree = memo(FileTreeInner);
