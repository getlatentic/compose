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
export function WorkspaceMenu() {
  const { recent, openFolder, openSample, openWorkspace, removeRecent, canOpenNativeFolder } =
    useWorkspaceActions();
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const openNewWindow = useWorkspaceStore((state) => state.openNewWindow);
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const activeName = activeWorkspace?.name ?? "No folder open";

  // Carbon's OverflowMenuItem has no submenu, so "open" and "remove" for one
  // workspace can't both live on the same row. We surface Open as the row's
  // primary action and a paired "Remove from list" item right beneath it,
  // grouped visually by a divider before the next workspace. ("Remove from
  // list" only drops the folder from Compose's recent list — it never deletes
  // files; the tooltip says so.)
  const topRecent = recent.slice(0, 8);

  return (
    <div className="bob-workspace-switcher" title={activeWorkspace?.path}>
      <span className="bob-workspace-switcher__name truncate">{activeName}</span>
      <OverflowMenu
        aria-label="Switch workspace"
        className="bob-workspace-switcher__menu"
        size="md"
        renderIcon={() => <ChevronDown size={16} />}
        menuOptionsClass="bob-workspace-switcher__options"
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
                className="bob-workspace-switcher__forget"
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
        <OverflowMenuItem
          key="new-window"
          itemText="Open in new window"
          requireTitle
          title="Open Compose in a fresh window — its own workspace, chat history, and runs."
          hasDivider
          onClick={() => void openNewWindow()}
        />
      </OverflowMenu>
    </div>
  );
}
