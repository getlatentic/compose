import { memo } from "react";
import { OverflowMenu, OverflowMenuItem } from "@carbon/react";
import { ChevronDown } from "@carbon/react/icons";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { useWorkspaceActions } from "./useWorkspaceActions";

/**
 * The sidebar workspace switcher, pinned to the top of {@link WorkspaceSidebar}.
 * Shows the active folder's name as the trigger and opens an
 * {@link OverflowMenu} of recent workspaces (open / forget), plus "Open a
 * folder…" and — in the browser preview — "Use sample workspace". All open
 * logic lives in {@link useWorkspaceActions}, shared with the no-workspace
 * welcome card.
 *
 * Replaces the old dark-header workspace menu: this redesign empties the top
 * bar and hosts the switcher in the sidebar instead.
 */
function WorkspaceMenuInner() {
  const { recent, openFolder, openSample, openWorkspace, removeRecent, canOpenNativeFolder } =
    useWorkspaceActions();
  // Narrow selectors: only the active workspace's name + path, not the
  // whole `workspaces` array — so a note edit doesn't re-render the
  // switcher (and its Carbon OverflowMenu).
  const activeName = useWorkspaceStore((state) => {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    return ws?.name ?? "No folder open";
  });
  const activePath = useWorkspaceStore((state) => {
    const ws = state.workspaces.find((w) => w.id === state.activeWorkspaceId);
    return ws?.path;
  });

  // Carbon's OverflowMenuItem has no submenu, so "open" and "remove" for one
  // workspace can't both live on the same row. We surface Open as the row's
  // primary action and a paired "Remove from list" item right beneath it,
  // grouped visually by a divider before the next workspace. ("Remove from
  // list" only drops the folder from Compose's recent list — it never deletes
  // files; the tooltip says so.)
  const topRecent = recent.slice(0, 8);

  return (
    <div className="workspace-switcher" title={activePath}>
      <span className="workspace-switcher__name truncate">{activeName}</span>
      <OverflowMenu
        aria-label="Switch workspace"
        className="workspace-switcher__menu"
        size="md"
        renderIcon={() => <ChevronDown size={16} />}
        menuOptionsClass="workspace-switcher__options"
        flipped
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
                className="workspace-switcher__forget"
                itemText="Remove from list"
                requireTitle
                title="Removes this folder from Compose's recent list. Your files are not deleted."
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
    </div>
  );
}

/**
 * Memoised — reads its name/path/recent via narrow selectors, so it
 * re-renders only when the workspace switcher's own data changes, not
 * on every note edit that re-renders the surrounding sidebar.
 */
export const WorkspaceMenu = memo(WorkspaceMenuInner);
