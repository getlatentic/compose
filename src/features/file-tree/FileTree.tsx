import {
  type DragEvent,
  type MouseEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { OverflowMenu, OverflowMenuItem } from "@carbon/react";
import { CaretDown, CaretRight, Document } from "@carbon/react/icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { WorkspaceFileEntry } from "./fileTreeTypes";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { useTextPrompt } from "../dialogs/TextPromptProvider";

/** Fixed row height in px — must match `.file-row` `block-size: 1.75rem` (28px)
 * in global.scss. The virtualizer needs it to place rows without measuring each. */
const ROW_HEIGHT = 28;

/** dataTransfer MIME for a file path dragged to move it into a folder (#28). */
const DRAG_FILE_MIME = "application/x-compose-file-path";

/**
 * The unsaved-edit dot for one file row. Self-subscribes to just that file's
 * dirty flag (a boolean), so a dirty flip on first-edit / autosave re-renders
 * ONLY this dot — never the row, its `OverflowMenu` (a Carbon Popover stack),
 * or the FileTree. Mirrors {@link TabDirtyDot} in PaneTabs. Before this, the
 * row's `dirty` prop flipped twice per edit burst (dirty on first keystroke,
 * clean on autosave), re-rendering the row + its Popover menu each time
 * (react-scan: Popover ×51 on a single file during a typing burst).
 */
function FileRowDirtyDot({ path }: { path: string }) {
  const dirty = useWorkspaceStore((state) => {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    return Boolean(ws?.fileContents[path]?.dirty);
  });
  return dirty ? <span className="dirty-dot" aria-label="Unsaved" /> : null;
}

/**
 * Row-menu wiring shared by file + folder rows. The Carbon `OverflowMenu` (the
 * ⋯ kebab) mounts lazily on first hover/focus — mounting one per row up front
 * tanked first paint on large vaults. Right-clicking the row opens that same
 * menu (and suppresses the OS context menu), so the row's actions are a
 * right-click away — the file-explorer expectation — without duplicating them.
 */
function useRowMenu() {
  const [menuMounted, setMenuMounted] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const openWhenMounted = useRef(false);
  const openMenu = useCallback(() => {
    wrapperRef.current?.querySelector<HTMLButtonElement>(".cds--overflow-menu")?.click();
  }, []);
  const mountMenu = useCallback(() => setMenuMounted(true), []);
  const onContextMenu = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      // Open our menu instead of the webview's native context menu. Defer the
      // open past this right-click's own mouseup — Carbon treats that mouseup as
      // an outside-click and would instantly close a menu opened synchronously.
      // (The not-yet-mounted branch is naturally deferred: it opens in the
      // effect below, after the mount render commits.)
      event.preventDefault();
      if (menuMounted) {
        window.setTimeout(openMenu, 0);
      } else {
        openWhenMounted.current = true;
        setMenuMounted(true);
      }
    },
    [menuMounted, openMenu],
  );
  // A right-click before the menu has ever mounted opens it once it renders.
  useEffect(() => {
    if (menuMounted && openWhenMounted.current) {
      openWhenMounted.current = false;
      openMenu();
    }
  }, [menuMounted, openMenu]);
  return { menuMounted, wrapperRef, mountMenu, onContextMenu };
}

/** Drop handling for a folder row: highlight while a draggable file is over it,
 *  and move that file in on drop. Handlers are memoised (like {@link useRowMenu})
 *  so the memoised FolderRow keeps stable identities across renders. */
function useFolderDrop(
  folderPath: string,
  onMoveHere: (fromPath: string, folderPath: string) => void,
) {
  const [dropTarget, setDropTarget] = useState(false);
  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(DRAG_FILE_MIME)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(true);
  }, []);
  const onDragLeave = useCallback(() => setDropTarget(false), []);
  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      setDropTarget(false);
      const from = event.dataTransfer.getData(DRAG_FILE_MIME);
      if (from) {
        event.preventDefault();
        onMoveHere(from, folderPath);
      }
    },
    [folderPath, onMoveHere],
  );
  return { dropTarget, onDragOver, onDragLeave, onDrop };
}

/**
 * One file row, memoised. Each row mounts a Carbon `OverflowMenu` (the ⋯
 * kebab) which drags in a Popover + Icon floating-ui stack. Before this,
 * the whole `rows.map` re-ran on any FileTree render — selecting a file
 * re-rendered all 50 rows' menus (react-scan: Icon ×201, Popover ×56,
 * 23 FPS, ~170ms/click). With per-row memo + stable callbacks, selecting
 * a file only re-renders the two rows whose `active` flips. The unsaved dot
 * is NOT a prop — it self-subscribes via {@link FileRowDirtyDot}, so a dirty
 * flip never re-renders the row or its Popover menu.
 */
const FileRow = memo(function FileRow({
  path,
  name,
  depth,
  active,
  onSelect,
  onRename,
  onDelete,
  onCopyPath,
  onReveal,
}: {
  path: string;
  name: string;
  depth: number;
  active: boolean;
  onSelect: (relativePath: string) => void;
  onRename: (relativePath: string) => void;
  onDelete: (relativePath: string) => void;
  onCopyPath: (relativePath: string) => void;
  onReveal: (relativePath: string) => void;
}) {
  // Carbon's `OverflowMenu` mounts a whole Popover + floating-ui + Icon stack
  // even while closed. Mounting one per row meant a large vault paid that cost
  // ×N up front — a 194-note vault tanked first paint to ~20 FPS (react-scan:
  // Popover ×590, Icon ×691, OverflowMenuVertical2 ×388). The kebab is only
  // revealed on hover/focus anyway (CSS opacity), so mount it lazily then; at
  // rest the slot is an empty same-size spacer (no layout shift), and a freshly
  // opened vault mounts ZERO menus.
  const { menuMounted, wrapperRef, mountMenu, onContextMenu } = useRowMenu();
  const onDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>) => {
      event.dataTransfer.setData(DRAG_FILE_MIME, path);
      event.dataTransfer.effectAllowed = "move";
    },
    [path],
  );
  return (
    <div
      ref={wrapperRef}
      className={["file-row-wrapper", active ? "file-row-wrapper--active" : ""]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={mountMenu}
      onFocus={mountMenu}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        draggable
        onDragStart={onDragStart}
        onClick={() => onSelect(path)}
        className={["file-row", active ? "file-row--active" : ""]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingInlineStart: `calc(0.5rem + ${depth} * 0.5rem)` }}
        title={path}
      >
        <Document size={16} />
        <span className="truncate">{name}</span>
        <FileRowDirtyDot path={path} />
      </button>
      {menuMounted ? (
        <OverflowMenu aria-label={`Actions for ${path}`} size="sm" flipped align="bottom">
          <OverflowMenuItem itemText="Rename..." onClick={() => onRename(path)} />
          <OverflowMenuItem itemText="Copy path" onClick={() => onCopyPath(path)} />
          <OverflowMenuItem itemText="Reveal in Finder" onClick={() => onReveal(path)} />
          <OverflowMenuItem hasDivider isDelete itemText="Delete" onClick={() => onDelete(path)} />
        </OverflowMenu>
      ) : (
        <span className="file-row-kebab-spacer" aria-hidden />
      )}
    </div>
  );
});

/** One folder row, memoised — re-renders only when its open/selected state
 * flips. Mirrors {@link FileRow}: a lazily-mounted, hover-revealed kebab with
 * folder actions ("New note here" / "Reveal in Finder"). `selected` marks it as
 * the destination a plain "New note" lands in. */
const FolderRow = memo(function FolderRow({
  path,
  name,
  depth,
  open,
  selected,
  onActivate,
  onNewNoteHere,
  onNewFolderHere,
  onMoveHere,
  onReveal,
}: {
  path: string;
  name: string;
  depth: number;
  open: boolean;
  selected: boolean;
  onActivate: (path: string) => void;
  onNewNoteHere: (path: string) => void;
  onNewFolderHere: (path: string) => void;
  onMoveHere: (fromPath: string, folderPath: string) => void;
  onReveal: (path: string) => void;
}) {
  const { menuMounted, wrapperRef, mountMenu, onContextMenu } = useRowMenu();
  const { dropTarget, onDragOver, onDragLeave, onDrop } = useFolderDrop(path, onMoveHere);
  return (
    <div
      ref={wrapperRef}
      className={[
        "file-row-wrapper",
        selected ? "file-row-wrapper--target" : "",
        dropTarget ? "file-row-wrapper--drop" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={mountMenu}
      onFocus={mountMenu}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="file-row file-row--folder"
        style={{ paddingInlineStart: `calc(0.5rem + ${depth} * 0.5rem)` }}
        onClick={() => onActivate(path)}
        aria-expanded={open}
        title={name}
      >
        {open ? <CaretDown size={16} /> : <CaretRight size={16} />}
        <span className="truncate">{name}</span>
      </button>
      {menuMounted ? (
        <OverflowMenu aria-label={`Actions for ${path}`} size="sm" flipped align="bottom">
          <OverflowMenuItem itemText="New note here" onClick={() => onNewNoteHere(path)} />
          <OverflowMenuItem itemText="New folder here" onClick={() => onNewFolderHere(path)} />
          <OverflowMenuItem itemText="Reveal in Finder" onClick={() => onReveal(path)} />
        </OverflowMenu>
      ) : (
        <span className="file-row-kebab-spacer" aria-hidden />
      )}
    </div>
  );
});

interface FolderNode {
  type: "folder";
  name: string;
  path: string;
  depth: number;
  children: TreeNode[];
}

interface FileNode {
  type: "file";
  name: string;
  path: string;
  depth: number;
}

type TreeNode = FolderNode | FileNode;

/** Stable virtual-list key for a row, so collapse/expand reorders reconcile
 * by identity rather than index. */
function rowKey(node: TreeNode): string {
  return node.type === "folder" ? `folder:${node.path}` : `file:${node.path}`;
}

function buildTree(files: WorkspaceFileEntry[]): TreeNode[] {
  const root: TreeNode[] = [];

  for (const file of files) {
    const segments = file.relativePath.split("/").filter(Boolean);
    let level = root;
    let pathSoFar = "";

    segments.forEach((segment, index) => {
      pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment;
      const isFile = index === segments.length - 1;

      if (isFile) {
        level.push({
          type: "file",
          name: segment,
          path: file.relativePath,
          depth: index,
        });
        return;
      }

      let folder = level.find(
        (node): node is FolderNode => node.type === "folder" && node.name === segment,
      );
      if (!folder) {
        folder = {
          type: "folder",
          name: segment,
          path: pathSoFar,
          depth: index,
          children: [],
        };
        level.push(folder);
      }
      level = folder.children;
    });
  }

  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === "folder" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.type === "folder") {
        sort(node.children);
      }
    }
  };
  sort(root);

  return root;
}

function flatten(nodes: TreeNode[], collapsed: Set<string>, out: TreeNode[] = []) {
  for (const node of nodes) {
    out.push(node);
    if (node.type === "folder" && !collapsed.has(node.path)) {
      flatten(node.children, collapsed, out);
    }
  }
  return out;
}

/** The folder paths leading to a file, outermost first — the ancestors that
 *  must be expanded for the file's row to appear in the flattened tree. */
export function ancestorFolders(path: string): string[] {
  const segments = path.split("/");
  segments.pop(); // drop the file name itself
  const out: string[] = [];
  let acc = "";
  for (const segment of segments) {
    acc = acc ? `${acc}/${segment}` : segment;
    out.push(acc);
  }
  return out;
}

function FileTreeInner({
  activePath,
  files,
  onDelete,
  onRename,
  onMoveFile,
  onSelectFile,
}: {
  activePath: string;
  files: WorkspaceFileEntry[];
  onDelete: (relativePath: string) => void;
  onRename: (relativePath: string) => void;
  onMoveFile: (fromPath: string, folderPath: string) => void;
  onSelectFile: (relativePath: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = useMemo(() => flatten(tree, collapsed), [tree, collapsed]);
  // The active workspace's scan runs in the background (MainApp no longer gates
  // the app on it), so an empty tree means "still scanning", not "no notes".
  const scanning = useWorkspaceStore((state) => {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    return ws ? ws.scanState !== "ready" && ws.scanState !== "failed" : false;
  });
  const workspaceRoot = useWorkspaceStore((state) => {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    return ws?.path ?? "";
  });
  // The folder a plain "New note" lands in. A string that changes only on a
  // deliberate select, so subscribing here re-renders the tree (and the two
  // folder rows whose `selected` flips) without touching the editing hot path.
  const promptText = useTextPrompt();
  const newNoteDir = useWorkspaceStore((state) => state.newNoteDir);
  const setNewNoteDir = useWorkspaceStore((state) => state.setNewNoteDir);
  const createNote = useWorkspaceStore((state) => state.createNote);

  // Stable so the memoised FolderRow doesn't re-render on every keystroke /
  // file-select that re-renders FileTree.
  const toggleFolder = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // File-row actions needing the absolute path (workspace root + relative path).
  const absPath = useCallback(
    (relativePath: string) =>
      workspaceRoot ? `${workspaceRoot.replace(/\/+$/, "")}/${relativePath}` : relativePath,
    [workspaceRoot],
  );
  const copyPath = useCallback(
    (relativePath: string) => void navigator.clipboard?.writeText(absPath(relativePath)),
    [absPath],
  );
  const revealInFinder = useCallback(
    (relativePath: string) => {
      void import("@tauri-apps/plugin-opener")
        .then(({ revealItemInDir }) => revealItemInDir(absPath(relativePath)))
        .catch(() => {});
    },
    [absPath],
  );

  // Clicking a folder both toggles it and marks it as the new-note target;
  // clicking a file targets its parent folder — so the highlighted target
  // always tracks where the user is, and gives a way back to the root (open a
  // root-level note). Stable so the memoised rows don't churn.
  const activateFolder = useCallback(
    (path: string) => {
      toggleFolder(path);
      setNewNoteDir(path);
    },
    [toggleFolder, setNewNoteDir],
  );
  const newNoteHere = useCallback(
    (path: string) => {
      setNewNoteDir(path);
      void createNote({ dir: path });
    },
    [setNewNoteDir, createNote],
  );
  // A markdown vault's tree is built from files, so a folder only appears once it
  // holds one. "New folder here" names the folder and seeds it with a first note
  // (which also survives a rescan, unlike a tracked-but-empty dir). Empty at root
  // (path === "") creates a top-level folder.
  const newFolderHere = useCallback(
    (path: string) => {
      void (async () => {
        const name = await promptText({
          title: "New folder",
          label: "Folder name",
          submitLabel: "Create",
        });
        const trimmed = name?.trim();
        if (!trimmed) {
          return;
        }
        const dir = path ? `${path}/${trimmed}` : trimmed;
        setNewNoteDir(dir);
        await createNote({ dir });
      })();
    },
    [promptText, setNewNoteDir, createNote],
  );
  const selectFileTrackingDir = useCallback(
    (relativePath: string) => {
      onSelectFile(relativePath);
      const slash = relativePath.lastIndexOf("/");
      setNewNoteDir(slash >= 0 ? relativePath.slice(0, slash) : "");
    },
    [onSelectFile, setNewNoteDir],
  );

  // Window the (already collapse-flattened) rows: only ~a viewport-worth mount,
  // regardless of vault size. `rows` already excludes descendants of collapsed
  // folders, so the count is exactly the currently-visible rows. Fixed row
  // height means no per-row measurement.
  const scrollRef = useRef<HTMLElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => rowKey(rows[index]),
  });

  // Reveal the active file: expand its ancestor folders so its row exists in the
  // flattened list, then scroll it into view. The ref bridges the two effects so
  // that an unrelated collapse/expand (which also changes `rows`) doesn't yank
  // the view back to the active file.
  const pendingReveal = useRef<string | null>(null);
  useEffect(() => {
    if (!activePath) return;
    pendingReveal.current = activePath;
    setCollapsed((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const folder of ancestorFolders(activePath)) {
        if (next.delete(folder)) changed = true;
      }
      return changed ? next : prev;
    });
  }, [activePath]);
  useEffect(() => {
    const target = pendingReveal.current;
    if (!target) return;
    const index = rows.findIndex((node) => node.type === "file" && node.path === target);
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: "auto" });
      pendingReveal.current = null;
    }
  }, [activePath, rows, virtualizer]);

  if (files.length === 0) {
    return (
      <div className="file-tree file-tree--empty">
        {scanning ? (
          <p>Loading notes…</p>
        ) : (
          <>
            <p>No notes yet</p>
            <p>Create a note or open a folder to get started.</p>
          </>
        )}
      </div>
    );
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
                  open={!collapsed.has(node.path)}
                  selected={node.path === newNoteDir}
                  onActivate={activateFolder}
                  onNewNoteHere={newNoteHere}
                  onNewFolderHere={newFolderHere}
                  onMoveHere={onMoveFile}
                  onReveal={revealInFinder}
                />
              ) : (
                <FileRow
                  path={node.path}
                  name={node.name}
                  depth={node.depth}
                  active={node.path === activePath}
                  onSelect={selectFileTrackingDir}
                  onRename={onRename}
                  onDelete={onDelete}
                  onCopyPath={copyPath}
                  onReveal={revealInFinder}
                />
              )}
            </div>
          );
        })}
      </div>
    </nav>
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
