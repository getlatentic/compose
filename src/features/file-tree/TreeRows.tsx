import { type CSSProperties, useState, useCallback, type DragEvent, memo, type MouseEvent } from "react";
import { File, ChevronRight, Folder } from "lucide-react";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { parentDirOf } from "./treeModel";
import type { OpenRowMenu } from "./RowMenu";
import { createDragGhost } from "./dragGhost";

/**
 * One row of the file tree, a note or a folder, and dropping a dragged note into a folder.
 */

/** The path of the file row being dragged, tracked here rather than read back
 *  from `dataTransfer`: WebKit doesn't expose a custom MIME in `dataTransfer.types`
 *  during `dragover` (and protects `getData` until drop), so a folder couldn't tell
 *  an in-app file drag from any other, never called `preventDefault()`, and so never
 *  became a drop target (the drag showed a "copy" cursor and the drop was dropped).
 *  Set on dragstart, read on dragover/drop, cleared on dragend. */
let draggedFilePath: string | null = null;

/** Indent for a tree depth, read by `_file-tree.scss`. */
function depthStyle(depth: number): CSSProperties {
  return { "--depth": depth } as CSSProperties;
}

/** dataTransfer MIME for a file path dragged to move it into a folder. */
const DRAG_FILE_MIME = "application/x-compose-file-path";

/**
 * The unsaved-edit dot for one file row. Self-subscribes to just that file's
 * dirty flag (a boolean), so a dirty flip on first-edit / autosave re-renders
 * ONLY this dot — never the row or the FileTree. Mirrors {@link TabDirtyDot}
 * in PaneTabs: a `dirty` prop would flip twice per edit burst (dirty on first
 * keystroke, clean on autosave) and re-render the row each time.
 */
function FileRowDirtyDot({ path }: { path: string }) {
  const dirty = useWorkspaceStore((state) => {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    return Boolean(ws?.fileContents[path]?.dirty);
  });
  return dirty ? <span className="dirty-dot" aria-label="Unsaved" /> : null;
}

/** Drop handling for any row that accepts a dragged file into `targetDir` — a
 *  folder row (its own path) or a file row (its parent dir, VS Code-style, so you
 *  can drop onto a file to land beside it). Highlights while a draggable file is
 *  over it and moves the file in on drop, but stays inert when the file already
 *  lives in `targetDir` (a no-op move) so the source row and its siblings don't
 *  light up. Handlers are memoised (like {@link useRowMenu}) so the memoised rows
 *  keep stable identities across renders. */
function useDropInto(
  targetDir: string,
  onMoveHere: (fromPath: string, folderPath: string) => void,
) {
  const [dropTarget, setDropTarget] = useState(false);
  const onDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (draggedFilePath === null || parentDirOf(draggedFilePath) === targetDir) {
        return;
      }
      // preventDefault is what marks this row a valid drop target — without it
      // the browser rejects the drop (the "copy" cursor) and `onDrop` never fires.
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(true);
    },
    [targetDir],
  );
  const onDragLeave = useCallback(() => setDropTarget(false), []);
  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDropTarget(false);
      const from = draggedFilePath ?? event.dataTransfer.getData(DRAG_FILE_MIME);
      draggedFilePath = null;
      if (from) {
        onMoveHere(from, targetDir);
      }
    },
    [targetDir, onMoveHere],
  );
  return { dropTarget, onDragOver, onDragLeave, onDrop };
}

/**
 * One file row, memoised — with per-row memo + stable callbacks, selecting a
 * file only re-renders the two rows whose `active` flips. The whole row is one
 * click/drag target (the button fills the wrapper), and right-click anywhere on
 * it opens the tree's shared context menu — there is no per-row menu instance,
 * so a large vault mounts zero menu stacks. The unsaved dot is NOT a prop — it
 * self-subscribes via {@link FileRowDirtyDot}, so a dirty flip never re-renders
 * the row.
 */
export const FileRow = memo(function FileRow({
  path,
  name,
  depth,
  active,
  onSelect,
  onMenu,
  onMoveHere,
}: {
  path: string;
  name: string;
  depth: number;
  active: boolean;
  onSelect: (relativePath: string) => void;
  onMenu: OpenRowMenu;
  onMoveHere: (fromPath: string, folderPath: string) => void;
}) {
  const onContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => onMenu(event, "file", path),
    [onMenu, path],
  );
  const handleSelect = useCallback(() => onSelect(path), [onSelect, path]);
  const onDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>) => {
      event.dataTransfer.setData(DRAG_FILE_MIME, path);
      event.dataTransfer.effectAllowed = "move";
      draggedFilePath = path;
      // Explicit drag image: rows sit in a translateY virtualizer, and
      // WebKit's default snapshot captures the untransformed origin, i.e. the
      // wrong row. A tile with the note's name is deterministic.
      const ghost = createDragGhost(document, name);
      document.body.appendChild(ghost);
      event.dataTransfer.setDragImage(ghost, 12, 12);
      setTimeout(() => ghost.remove(), 0);
    },
    [path, name],
  );
  // Clears the tracked path when a drag ends anywhere (dropped outside a folder,
  // or cancelled) so a later dragover doesn't see a stale drag.
  const onDragEnd = useCallback(() => {
    draggedFilePath = null;
  }, []);
  // A file row is also a drop target: dropping onto it lands the dragged file in
  // this file's folder (VS Code-style), so you needn't aim for the folder row.
  const { dropTarget, onDragOver, onDragLeave, onDrop } = useDropInto(
    parentDirOf(path),
    onMoveHere,
  );
  return (
    <div
      className={[
        "file-row-wrapper",
        active ? "file-row-wrapper--active" : "",
        dropTarget ? "file-row-wrapper--drop" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        type="button"
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={handleSelect}
        className={["file-row", active ? "file-row--active" : ""]
          .filter(Boolean)
          .join(" ")}
        style={depthStyle(depth)}
        title={path}
      >
        {/* The empty disclosure slot lines a file's icon up under its folder's. */}
        <span aria-hidden />
        <File size={16} strokeWidth={1.5} aria-hidden />
        <span className="truncate">{name}</span>
        <FileRowDirtyDot path={path} />
      </button>
    </div>
  );
});

/** One folder row, memoised — re-renders only when its open/selected state
 * flips. Mirrors {@link FileRow}: the whole row toggles the folder, and
 * right-click opens the tree's shared context menu with the folder actions.
 * `selected` marks it as the destination a plain "New note" lands in. */
export const FolderRow = memo(function FolderRow({
  path,
  name,
  depth,
  open,
  selected,
  onActivate,
  onMenu,
  onMoveHere,
}: {
  path: string;
  name: string;
  depth: number;
  open: boolean;
  selected: boolean;
  onActivate: (path: string) => void;
  onMenu: OpenRowMenu;
  onMoveHere: (fromPath: string, folderPath: string) => void;
}) {
  const onContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => onMenu(event, "folder", path),
    [onMenu, path],
  );
  const handleActivate = useCallback(() => onActivate(path), [onActivate, path]);
  const { dropTarget, onDragOver, onDragLeave, onDrop } = useDropInto(path, onMoveHere);
  return (
    <div
      className={[
        "file-row-wrapper",
        selected ? "file-row-wrapper--target" : "",
        dropTarget ? "file-row-wrapper--drop" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="file-row file-row--folder"
        style={depthStyle(depth)}
        onClick={handleActivate}
        aria-expanded={open}
        title={name}
      >
        <ChevronRight className="file-row__chevron" size={16} strokeWidth={1.5} aria-hidden />
        <Folder size={16} strokeWidth={1.5} aria-hidden />
        <span className="truncate">{name}</span>
      </button>
    </div>
  );
});
