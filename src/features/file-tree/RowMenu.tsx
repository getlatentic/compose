import { Menu, MenuItem, MenuItemDivider } from "@carbon/react";
import { Fragment, useCallback, useMemo, useRef, useState, type MouseEvent } from "react";

import { canShowNativeMenu, showNativeMenu, type MenuAction } from "../../lib/runtime/nativeMenu";

export type RowKind = "file" | "folder";

/** What a row's right-click can do, each given the row's path. */
export interface RowMenuHandlers {
  readonly rename: (path: string) => void;
  readonly copyPath: (path: string) => void;
  readonly reveal: (path: string) => void;
  readonly deleteFile: (path: string) => void;
  readonly newNoteHere: (path: string) => void;
  readonly newFolderHere: (path: string) => void;
  readonly deleteFolder: (path: string) => void;
}

/** The menu for one row, as the native and the HTML menu both draw it. */
export function rowMenuActions(kind: RowKind, path: string, handlers: RowMenuHandlers): MenuAction[] {
  const on = (handler: (path: string) => void) => () => handler(path);
  if (kind === "file") {
    return [
      { label: "Rename…", run: on(handlers.rename) },
      { label: "Copy path", run: on(handlers.copyPath) },
      { label: "Reveal in Finder", run: on(handlers.reveal) },
      { label: "Delete", run: on(handlers.deleteFile), danger: true, startsGroup: true },
    ];
  }
  return [
    { label: "New note here", run: on(handlers.newNoteHere) },
    { label: "New folder here", run: on(handlers.newFolderHere) },
    { label: "Reveal in Finder", run: on(handlers.reveal) },
    { label: "Delete folder", run: on(handlers.deleteFolder), danger: true, startsGroup: true },
  ];
}

/** Opens the tree's context menu for one row. Rows pass their own kind/path. */
export type OpenRowMenu = (event: MouseEvent<HTMLDivElement>, kind: RowKind, path: string) => void;

interface OpenMenu {
  readonly path: string;
  readonly actions: readonly MenuAction[];
  readonly x: number;
  readonly y: number;
}

/**
 * ONE context menu for the whole tree, opened at the pointer from any row's
 * right-click: the system's own menu in Compose, Carbon's elsewhere.
 * `openRowMenu` is stable, so memoised rows are not re-rendered by it; it
 * reads the current handlers when the menu opens.
 */
export function useRowMenu(handlers: RowMenuHandlers) {
  const current = useRef(handlers);
  current.current = handlers;
  const [open, setOpen] = useState<OpenMenu | null>(null);

  const openRowMenu = useCallback<OpenRowMenu>((event, kind, path) => {
    event.preventDefault();
    const { clientX: x, clientY: y } = event;
    const actions = rowMenuActions(kind, path, current.current);
    if (canShowNativeMenu()) {
      void showNativeMenu(actions, { x, y });
      return;
    }
    // The HTML menu opens past this right-click's own mouseup: opened
    // synchronously, it registers that mouseup as an outside click and closes.
    window.setTimeout(() => setOpen({ path, actions, x, y }), 0);
  }, []);
  const closeRowMenu = useCallback(() => setOpen(null), []);

  return { openRowMenu, openMenu: open, closeRowMenu };
}

/** The HTML menu, outside Compose. */
export function RowMenuList({ menu, onClose }: { readonly menu: OpenMenu; readonly onClose: () => void }) {
  const items = useMemo(
    () =>
      menu.actions.map((action) => (
        <Fragment key={action.label}>
          {action.startsGroup ? <MenuItemDivider /> : null}
          <MenuItem label={action.label} kind={action.danger ? "danger" : "default"} onClick={action.run} />
        </Fragment>
      )),
    [menu.actions],
  );
  return (
    <Menu label={`Actions for ${menu.path}`} size="sm" open x={menu.x} y={menu.y} onClose={onClose}>
      {items}
    </Menu>
  );
}
