import { OverflowMenu, OverflowMenuItem } from "@carbon/react";
import { Home } from "@carbon/react/icons";
import { useWorkspaceActions } from "./useWorkspaceActions";

/**
 * The top-bar workspace switcher. Replaces the old standalone dashboard: the
 * Home action is now an {@link OverflowMenu} listing recent workspaces (open /
 * remove), plus "Open a folder…" and — in the browser preview — "Use sample
 * workspace". All open logic lives in {@link useWorkspaceActions}, shared with
 * the no-workspace welcome card.
 *
 * Rendered with the dark-header styling (see `.bob-header-menu` in global.scss)
 * so its trigger matches the Carbon HeaderGlobalActions beside it.
 */
export function WorkspaceMenu() {
  const { recent, openFolder, openSample, openWorkspace, removeRecent, canOpenNativeFolder } =
    useWorkspaceActions();

  // Carbon's OverflowMenuItem has no submenu, so "open" and "remove from list"
  // for one workspace can't both live on the same row. We surface Open as the
  // row's primary action and a paired "Remove <name>" item right beneath it,
  // grouped visually by a divider before the next workspace.
  const topRecent = recent.slice(0, 8);

  return (
    <OverflowMenu
      aria-label="Workspaces"
      className="bob-header-menu"
      size="lg"
      renderIcon={() => <Home size={20} />}
      flipped
      menuOptionsClass="bob-header-menu__options"
    >
      {topRecent.length > 0
        ? topRecent.flatMap((record, index) => [
            <OverflowMenuItem
              key={`open:${record.id}`}
              itemText={record.name}
              requireTitle
              title={record.path}
              hasDivider={index > 0}
              onClick={() => openWorkspace(record.id)}
            />,
            <OverflowMenuItem
              key={`remove:${record.id}`}
              className="bob-header-menu__remove"
              itemText="Remove from list"
              isDelete
              onClick={() => void removeRecent(record.id)}
            />,
          ])
        : null}
      <OverflowMenuItem
        key="open-folder"
        itemText="Open a folder…"
        hasDivider={topRecent.length > 0}
        onClick={() => void openFolder()}
      />
      {!canOpenNativeFolder ? (
        <OverflowMenuItem
          key="sample"
          itemText="Use sample workspace"
          onClick={() => void openSample()}
        />
      ) : null}
    </OverflowMenu>
  );
}
