import type { WorkspaceFileEntry } from "./fileTreeTypes";
import { useWorkspaceStore } from "../../app/workspaceStore";

/**
 * The file tree as data: folders and notes from the workspace's file list, flattened to the rows on screen.
 */

/** The parent directory of a path ("" for a root item). */
export function parentDirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

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

export type TreeNode = FolderNode | FileNode;

/** Stable virtual-list key for a row, so collapse/expand reorders reconcile
 * by identity rather than index. */
export function rowKey(node: TreeNode): string {
  return node.type === "folder" ? `folder:${node.path}` : `file:${node.path}`;
}

export function buildTree(files: WorkspaceFileEntry[], folders: string[]): TreeNode[] {
  const root: TreeNode[] = [];

  // Walk (creating as needed) the folder-node chain for a directory path,
  // returning the deepest folder's `children` — where its files/subfolders go.
  const ensureFolder = (segments: string[]): TreeNode[] => {
    let level = root;
    let pathSoFar = "";
    segments.forEach((segment, index) => {
      pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment;
      let folder = level.find(
        (node): node is FolderNode => node.type === "folder" && node.name === segment,
      );
      if (!folder) {
        folder = { type: "folder", name: segment, path: pathSoFar, depth: index, children: [] };
        level.push(folder);
      }
      level = folder.children;
    });
    return level;
  };

  // Materialise every directory first — incl. empty ones — so a folder with no
  // markdown file still appears (and survives losing its last file).
  for (const folder of folders) {
    ensureFolder(folder.split("/").filter(Boolean));
  }

  for (const file of files) {
    const segments = file.relativePath.split("/").filter(Boolean);
    const fileName = segments.pop();
    if (fileName === undefined) {
      continue;
    }
    const level = segments.length > 0 ? ensureFolder(segments) : root;
    level.push({ type: "file", name: fileName, path: file.relativePath, depth: segments.length });
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

/** The rows a tree shows given the set of OPEN folder paths: a folder's children
 *  appear only when its path is in `expanded`, so an absent folder stays closed
 *  (the default, so the tree opens collapsed). */
export function flatten(nodes: TreeNode[], expanded: Set<string>, out: TreeNode[] = []) {
  for (const node of nodes) {
    out.push(node);
    if (node.type === "folder" && expanded.has(node.path)) {
      flatten(node.children, expanded, out);
    }
  }
  return out;
}

/** The document whose folders should be open. The `activePath` prop is blank
 *  while an external file holds focus — the tree drops its highlight then — but
 *  the workspace's own open file is still what the folders should be showing,
 *  so collapsing them on that blank is a jump with nothing behind it. */
export function revealedPath(activePath: string): string {
  if (activePath) {
    return activePath;
  }
  const state = useWorkspaceStore.getState();
  return (
    state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId)
      ?.activeFilePath ?? ""
  );
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
