import { useCallback, useMemo } from "react";
import { InlineNotification } from "@carbon/react";
import { AddAlt } from "@carbon/react/icons";
import { PanelLeft, Search, Settings } from "lucide-react";
import type { BobWorkspace } from "../../app/workspaceModel";
import { useWorkspaceStore } from "../../app/workspaceStore";
import type { WorkspaceBacklinkRecord } from "../../lib/ipc/indexClient";
import { useTextPrompt } from "../dialogs/TextPromptProvider";
import { FileTree } from "../file-tree/FileTree";
import { SidebarChatList } from "../chat/SidebarChatList";
import { PropertiesPanel } from "./PropertiesPanel";
import { WorkspaceMenu } from "./WorkspaceMenu";

/**
 * Width reserved for the macOS traffic lights when `titleBarStyle: Overlay` is
 * enabled. 78px clears all three lights + their inner padding at the system
 * default size; smaller values clip the rightmost (Maximize) button on Sonoma+
 * Big Sur, which exposes a slightly larger hit target than the marker dots
 * would suggest. Both the sidebar titlebar (when expanded) and the editor tab
 * strip (when the sidebar is collapsed) reserve this space.
 */
export const MAC_TRAFFIC_LIGHTS_INSET = 78;

/**
 * The sidebar — first column of the workspace shell.
 *
 * Layout, top → bottom:
 *   1. **Titlebar row** (40px, drag region): traffic-light spacer + sidebar
 *      collapse toggle (PanelLeft) + back/forward chevrons (browser-style).
 *   2. **Workspace switcher** (the existing {@link WorkspaceMenu} dropdown,
 *      now with "Open in new window").
 *   3. **Notes/Chat tabs** + a context-aware "New" button.
 *   4. **Tab body** — file tree + properties (Notes) or conversation list
 *      (Chat). Search moved OUT of the sidebar to a footer popover; the
 *      INDEX section is gone.
 *   5. **Footer** (pinned): "X notes" counter + Search + Settings icons.
 *
 * When `sidebarCollapsed` is true, the whole sidebar is removed from the
 * layout (the editor's tab strip then owns the traffic-lights inset and shows
 * a re-open toggle). The state lives in the store so the editor can read it
 * symmetrically.
 */
export function WorkspaceSidebar() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const createNote = useWorkspaceStore((state) => state.createNote);
  const newChat = useWorkspaceStore((state) => state.newChat);
  const deleteActiveFile = useWorkspaceStore((state) => state.deleteActiveFile);
  const renameActiveFile = useWorkspaceStore((state) => state.renameActiveFile);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const updateActiveContent = useWorkspaceStore((state) => state.updateActiveContent);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const sidebarTab = useWorkspaceStore((state) => state.sidebarTab);
  const setSidebarTab = useWorkspaceStore((state) => state.setSidebarTab);
  const sidebarCollapsed = useWorkspaceStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useWorkspaceStore((state) => state.toggleSidebar);
  const openSettings = useWorkspaceStore((state) => state.openSettings);
  const openSearch = useWorkspaceStore((state) => state.openSearch);
  const promptText = useTextPrompt();
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );
  const activeBacklinks = useMemo(() => activeFileBacklinks(activeWorkspace), [activeWorkspace]);
  // The active file's current content. Drives the Properties
  // panel below — we parse frontmatter out of this on every
  // render. Cheap (regex + small YAML), so no memoization needed.
  const activeFileContent = activeWorkspace?.activeFilePath
    ? activeWorkspace.fileContents[activeWorkspace.activeFilePath]?.content ?? null
    : null;

  // "X notes" counter for the footer — markdown files in the active workspace.
  // Cheap (the file list is already in memory), no memoization needed.
  const noteCount = activeWorkspace?.files.filter((entry) =>
    entry.relativePath.toLowerCase().endsWith(".md"),
  ).length ?? 0;

  // Stable callbacks so FileTree's memo can short-circuit on
  // workspace store ticks that don't actually shift the file list
  // (chat tokens, autosaves, fs events).
  const handleRename = useCallback(
    async (relativePath: string) => {
      await selectFile(relativePath);
      const next = await promptText({
        title: "Rename file",
        label: "New name",
        defaultValue: relativePath,
        submitLabel: "Rename",
      });
      if (!next || next.trim() === relativePath) {
        return;
      }
      await renameActiveFile(next.trim());
    },
    [selectFile, renameActiveFile, promptText],
  );

  const handleDelete = useCallback(
    async (relativePath: string) => {
      if (!window.confirm(`Delete ${relativePath}? This cannot be undone.`)) {
        return;
      }
      await selectFile(relativePath);
      await deleteActiveFile();
    },
    [selectFile, deleteActiveFile],
  );

  // FileTree's onSelectFile and PropertiesPanel's onChange both pass
  // through to store actions. The wrapping arrows would be new
  // references every render — useCallback keeps memo stable.
  const handleSelectFile = useCallback(
    (relativePath: string) => void selectFile(relativePath),
    [selectFile],
  );
  const handleUpdateContent = useCallback(
    (next: string) => updateActiveContent(next, []),
    [updateActiveContent],
  );
  const handleDeleteAdapter = useCallback(
    (relativePath: string) => void handleDelete(relativePath),
    [handleDelete],
  );
  const handleRenameAdapter = useCallback(
    (relativePath: string) => void handleRename(relativePath),
    [handleRename],
  );

  // One context-aware "New" button: a note on the Notes tab, a chat on the
  // Chat tab.
  const newLabel = sidebarTab === "files" ? "New note" : "New chat";
  const onNew = sidebarTab === "files" ? createNote : newChat;

  if (sidebarCollapsed) {
    return null;
  }

  return (
    <aside className="bob-sidebar">
      <div
        className="bob-sidebar-titlebar"
        data-tauri-drag-region
        // The whole row is a drag region (Tauri honors `data-tauri-drag-region`
        // exactly like the older `-webkit-app-region: drag`). The PanelLeft
        // button below opts OUT via `no-drag` on itself.
        style={{ ["--bob-traffic-lights-inset" as never]: `${MAC_TRAFFIC_LIGHTS_INSET}px` }}
      >
        <button
          type="button"
          className="bob-sidebar-titlebar__btn"
          data-tauri-drag-region="false"
          onClick={() => toggleSidebar()}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          <PanelLeft size={16} aria-hidden />
        </button>
      </div>

      <WorkspaceMenu />

      <div className="bob-sidebar-tabs" role="tablist" aria-label="Sidebar">
        <button
          type="button"
          role="tab"
          aria-selected={sidebarTab === "files"}
          className={[
            "bob-sidebar-tab",
            sidebarTab === "files" ? "bob-sidebar-tab--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setSidebarTab("files")}
        >
          Notes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sidebarTab === "chat"}
          className={[
            "bob-sidebar-tab",
            sidebarTab === "chat" ? "bob-sidebar-tab--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setSidebarTab("chat")}
        >
          Chat
        </button>
        <button
          type="button"
          className="bob-sidebar-new"
          onClick={() => void onNew()}
          disabled={!activeWorkspace}
          aria-label={newLabel}
          title={newLabel}
        >
          <AddAlt size={16} />
          <span>{newLabel}</span>
        </button>
      </div>

      {sidebarTab === "files" ? (
        <FilesTab
          activeWorkspace={activeWorkspace}
          onSelectFile={handleSelectFile}
          onRenameFile={handleRenameAdapter}
          onDeleteFile={handleDeleteAdapter}
          activeFileContent={activeFileContent}
          onUpdateContent={handleUpdateContent}
          backlinks={activeBacklinks}
        />
      ) : (
        <div className="bob-sidebar-pane bob-sidebar-pane--chat">
          {activeWorkspace ? (
            <SidebarChatList />
          ) : (
            <div className="bob-sidebar-chat__empty">
              <p>Open a folder to see its conversations.</p>
            </div>
          )}
        </div>
      )}

      <div className="bob-sidebar-footer">
        <span className="bob-sidebar-footer__count">
          {activeWorkspace ? `${noteCount} note${noteCount === 1 ? "" : "s"}` : "No folder"}
        </span>
        <div className="bob-sidebar-footer__actions">
          <button
            type="button"
            className="bob-sidebar-footer__btn"
            onClick={() => openSearch()}
            disabled={!activeWorkspace}
            aria-label="Search workspace"
            title="Search"
          >
            <Search size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="bob-sidebar-footer__btn"
            onClick={() => openSettings()}
            aria-label="Open settings"
            title="Settings"
          >
            <Settings size={16} aria-hidden />
          </button>
        </div>
      </div>
    </aside>
  );
}

/**
 * The Files tab body: the file tree, the active file's Properties (frontmatter)
 * editor, and the backlinks list. Search moved to the footer popover — the
 * INDEX section is gone from here.
 */
function FilesTab({
  activeWorkspace,
  onSelectFile,
  onRenameFile,
  onDeleteFile,
  activeFileContent,
  onUpdateContent,
  backlinks,
}: {
  activeWorkspace: BobWorkspace | null;
  onSelectFile: (path: string) => void;
  onRenameFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  activeFileContent: string | null;
  onUpdateContent: (next: string) => void;
  backlinks: WorkspaceBacklinkRecord[];
}) {
  if (!activeWorkspace) {
    return (
      <div className="bob-sidebar-pane bob-sidebar-pane--files">
        <InlineNotification
          hideCloseButton
          kind="info"
          lowContrast
          subtitle="Open a folder to browse its files."
          title="No folder open"
        />
      </div>
    );
  }

  return (
    <div className="bob-sidebar-pane bob-sidebar-pane--files">
      <div className="bob-sidebar-files">
        <FileTree
          activePath={activeWorkspace.activeFilePath}
          fileContents={activeWorkspace.fileContents}
          files={activeWorkspace.files}
          onDelete={onDeleteFile}
          onRename={onRenameFile}
          onSelectFile={onSelectFile}
        />
      </div>

      {activeFileContent !== null ? (
        <PropertiesPanel markdown={activeFileContent} onChange={onUpdateContent} />
      ) : null}

      {backlinks.length > 0 ? <BacklinksList backlinks={backlinks} onSelectFile={onSelectFile} /> : null}
    </div>
  );
}

function BacklinksList({
  backlinks,
  onSelectFile,
}: {
  backlinks: WorkspaceBacklinkRecord[];
  onSelectFile: (path: string) => void;
}) {
  return (
    <div className="bob-backlinks" aria-label="Backlinks">
      <div className="bob-section-label bob-section-label--compact">
        <span>Backlinks</span>
        <span className="bob-section-meta">{backlinks.length}</span>
      </div>
      {backlinks.slice(0, 6).map((backlink) => (
        <button
          type="button"
          key={`${backlink.sourceDocId}:${backlink.sourceRange.start}`}
          className="bob-backlink"
          onClick={() => onSelectFile(backlink.sourcePath)}
        >
          <span className="bob-backlink__path">{backlink.sourcePath}</span>
          <span className="bob-backlink__label">{backlink.label}</span>
        </button>
      ))}
    </div>
  );
}

function activeFileBacklinks(workspace: BobWorkspace | null) {
  if (!workspace?.activeFilePath || !workspace.indexSnapshot) {
    return [];
  }
  const activeDocument = workspace.indexSnapshot.documents.find(
    (document) => document.path === workspace.activeFilePath,
  );
  return workspace.indexSnapshot.backlinks.filter((backlink) => {
    if (activeDocument && backlink.targetDocId === activeDocument.docId) {
      return true;
    }
    return backlink.targetPath === workspace.activeFilePath;
  });
}
