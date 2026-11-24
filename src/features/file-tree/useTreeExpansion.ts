import type { Virtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { ancestorFolders, revealedPath, type TreeNode } from "./treeModel";

type Expanded = Set<string>;

/**
 * Which folders are open. Folders start closed, so a workspace opens showing
 * its top level plus the folders around the open note; seeded from that note
 * rather than opened a frame later, which would move every row below it.
 * Switching workspace seeds again; the writer's own opening and closing is
 * left alone.
 */
export function useExpandedFolders(tree: readonly TreeNode[], workspaceRoot: string, activePath: string) {
  const [expanded, setExpanded] = useState<Expanded>(() => new Set(ancestorFolders(revealedPath(activePath))));
  const seededFor = useRef<string>(workspaceRoot);
  useEffect(() => {
    if (seededFor.current === workspaceRoot || tree.length === 0) return;
    seededFor.current = workspaceRoot;
    setExpanded(new Set(ancestorFolders(revealedPath(activePath))));
  }, [tree, workspaceRoot, activePath]);

  const toggleFolder = useCallback((path: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  return { expanded, setExpanded, toggleFolder };
}

interface RevealTarget {
  /** The row to show, or empty for none. */
  readonly path: string;
  readonly type: TreeNode["type"];
  /** The folders to open so the row exists. */
  readonly folders: readonly string[];
}

/**
 * Bring a row into view when it becomes the target: open the folders around
 * it now, scroll once the rows include it. Remembering the target between
 * the two steps keeps an unrelated open or close, which also changes the
 * rows, from scrolling back to it.
 */
export function useRevealRow(
  { path, type, folders }: RevealTarget,
  rows: readonly TreeNode[],
  virtualizer: Virtualizer<HTMLElement, Element>,
  setExpanded: Dispatch<SetStateAction<Expanded>>,
) {
  const pending = useRef<string | null>(null);
  useEffect(() => {
    if (!path) return;
    pending.current = path;
    setExpanded((previous) => {
      if (folders.every((folder) => previous.has(folder))) return previous;
      const next = new Set(previous);
      for (const folder of folders) next.add(folder);
      return next;
    });
    // `folders` follows from `path`.
  }, [path]);
  useEffect(() => {
    const target = pending.current;
    if (!target) return;
    const index = rows.findIndex((node) => node.type === type && node.path === target);
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: "auto" });
      pending.current = null;
    }
  }, [path, type, rows, virtualizer]);
}
