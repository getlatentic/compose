import { memo, useMemo, useState } from "react";
import { OverflowMenu, OverflowMenuItem } from "@carbon/react";
import { CaretDown, CaretRight, Document } from "@carbon/react/icons";
import type { WorkspaceFileBuffer, WorkspaceFileEntry } from "./fileTreeTypes";

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
  fileContents,
  files,
  onDelete,
  onRename,
  onSelectFile,
}: {
  activePath: string;
  fileContents: Record<string, WorkspaceFileBuffer>;
  files: WorkspaceFileEntry[];
  onDelete: (relativePath: string) => void;
  onRename: (relativePath: string) => void;
  onSelectFile: (relativePath: string) => void;
}) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = useMemo(() => flatten(tree, collapsed), [tree, collapsed]);

  function toggleFolder(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  if (files.length === 0) {
    return (
      <div className="bob-file-tree bob-file-tree--empty">
        <p>No Markdown files</p>
        <p>Create a note from the toolbar.</p>
      </div>
    );
  }

  return (
    <nav className="bob-file-tree" aria-label="Files">
      {rows.map((node) => {
        if (node.type === "folder") {
          const open = !collapsed.has(node.path);
          return (
            <button
              type="button"
              key={`folder:${node.path}`}
              className="bob-file-row bob-file-row--folder"
              style={{ paddingInlineStart: `calc(0.5rem + ${node.depth} * 0.875rem)` }}
              onClick={() => toggleFolder(node.path)}
              aria-expanded={open}
            >
              {open ? <CaretDown size={16} /> : <CaretRight size={16} />}
              <span className="truncate">{node.name}</span>
            </button>
          );
        }

        const active = node.path === activePath;
        const buffer = fileContents[node.path];
        return (
          <div
            key={`file:${node.path}`}
            className={["bob-file-row-wrapper", active ? "bob-file-row-wrapper--active" : ""]
              .filter(Boolean)
              .join(" ")}
          >
            <button
              type="button"
              onClick={() => onSelectFile(node.path)}
              className={["bob-file-row", active ? "bob-file-row--active" : ""]
                .filter(Boolean)
                .join(" ")}
              style={{ paddingInlineStart: `calc(0.5rem + ${node.depth} * 0.875rem)` }}
              title={node.path}
            >
              <Document size={16} />
              <span className="truncate">{node.name}</span>
              {buffer?.dirty ? <span className="bob-dirty-dot" aria-label="Unsaved" /> : null}
            </button>
            <OverflowMenu
              aria-label={`Actions for ${node.path}`}
              size="sm"
              flipped
              align="bottom"
            >
              <OverflowMenuItem itemText="Rename..." onClick={() => onRename(node.path)} />
              <OverflowMenuItem
                hasDivider
                isDelete
                itemText="Delete"
                onClick={() => onDelete(node.path)}
              />
            </OverflowMenu>
          </div>
        );
      })}
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
