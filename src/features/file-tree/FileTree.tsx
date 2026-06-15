import { memo, useCallback, useMemo, useState } from "react";
import { OverflowMenu, OverflowMenuItem } from "@carbon/react";
import { CaretDown, CaretRight, Document } from "@carbon/react/icons";
import type { WorkspaceFileEntry } from "./fileTreeTypes";
import { useWorkspaceStore } from "../../app/workspaceStore";

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
}: {
  path: string;
  name: string;
  depth: number;
  active: boolean;
  onSelect: (relativePath: string) => void;
  onRename: (relativePath: string) => void;
  onDelete: (relativePath: string) => void;
}) {
  return (
    <div
      className={["file-row-wrapper", active ? "file-row-wrapper--active" : ""]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        type="button"
        onClick={() => onSelect(path)}
        className={["file-row", active ? "file-row--active" : ""]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingInlineStart: `calc(0.5rem + ${depth} * 0.875rem)` }}
        title={path}
      >
        <Document size={16} />
        <span className="truncate">{name}</span>
        <FileRowDirtyDot path={path} />
      </button>
      <OverflowMenu aria-label={`Actions for ${path}`} size="sm" flipped align="bottom">
        <OverflowMenuItem itemText="Rename..." onClick={() => onRename(path)} />
        <OverflowMenuItem hasDivider isDelete itemText="Delete" onClick={() => onDelete(path)} />
      </OverflowMenu>
    </div>
  );
});

/** One folder row, memoised — only re-renders when its own open state flips. */
const FolderRow = memo(function FolderRow({
  path,
  name,
  depth,
  open,
  onToggle,
}: {
  path: string;
  name: string;
  depth: number;
  open: boolean;
  onToggle: (path: string) => void;
}) {
  return (
    <button
      type="button"
      className="file-row file-row--folder"
      style={{ paddingInlineStart: `calc(0.5rem + ${depth} * 0.875rem)` }}
      onClick={() => onToggle(path)}
      aria-expanded={open}
    >
      {open ? <CaretDown size={16} /> : <CaretRight size={16} />}
      <span className="truncate">{name}</span>
    </button>
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

function FileTreeInner({
  activePath,
  files,
  onDelete,
  onRename,
  onSelectFile,
}: {
  activePath: string;
  files: WorkspaceFileEntry[];
  onDelete: (relativePath: string) => void;
  onRename: (relativePath: string) => void;
  onSelectFile: (relativePath: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = useMemo(() => flatten(tree, collapsed), [tree, collapsed]);

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

  if (files.length === 0) {
    return (
      <div className="file-tree file-tree--empty">
        <p>No Markdown files</p>
        <p>Create a note from the toolbar.</p>
      </div>
    );
  }

  return (
    <nav className="file-tree" aria-label="Files">
      {rows.map((node) =>
        node.type === "folder" ? (
          <FolderRow
            key={`folder:${node.path}`}
            path={node.path}
            name={node.name}
            depth={node.depth}
            open={!collapsed.has(node.path)}
            onToggle={toggleFolder}
          />
        ) : (
          <FileRow
            key={`file:${node.path}`}
            path={node.path}
            name={node.name}
            depth={node.depth}
            active={node.path === activePath}
            onSelect={onSelectFile}
            onRename={onRename}
            onDelete={onDelete}
          />
        ),
      )}
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
