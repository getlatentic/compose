import { memo, useCallback, useMemo } from "react";
import { InlineNotification } from "@carbon/react";
import { AddAlt, FolderAdd } from "@carbon/react/icons";
import { useTextPrompt } from "../dialogs/TextPromptProvider";
import { PanelLeft, Search, Settings } from "lucide-react";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { useUiStore } from "../../app/store/uiStore";
import { useWindowDrag } from "../../lib/runtime/useWindowDrag";
import { useRename } from "../dialogs/RenameProvider";
import { useConfirm } from "../dialogs/ConfirmProvider";
import { FileTree } from "../file-tree/FileTree";
import type { WorkspaceFileEntry } from "../file-tree/fileTreeTypes";
import { SidebarChatList } from "../chat/SidebarChatList";
import { ActiveFileProperties } from "./ActiveFilePanels";
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
  const createNote = useWorkspaceStore((state) => state.createNote);
  const createFolder = useWorkspaceStore((state) => state.createFolder);
  const newNoteDir = useWorkspaceStore((state) => state.newNoteDir);
  const promptText = useTextPrompt();
  const newChat = useWorkspaceStore((state) => state.newChat);
  const deleteActiveFile = useWorkspaceStore((state) => state.deleteActiveFile);
  const renameActiveFile = useWorkspaceStore((state) => state.renameActiveFile);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const sidebarTab = useUiStore((state) => state.sidebarTab);
  const setSidebarTab = useUiStore((state) => state.setSidebarTab);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const openSettings = useUiStore((state) => state.openSettings);
  const openSearch = useUiStore((state) => state.openSearch);
  const onTitlebarMouseDown = useWindowDrag();
  const requestRename = useRename();
  const confirm = useConfirm();
  // Narrow, churn-free reads: a boolean for "is a workspace open" + the footer
  // note count. Both are primitives, so editing/saving (which churns the
  // workspace object on every flush) never re-renders the sidebar shell. The
  // file list + dirty state are subscribed INSIDE FilesTab (self-subscribing).
  const hasWorkspace = useWorkspaceStore((state) =>
    state.workspaces.some((workspace) => workspace.id === state.activeWorkspaceId),
  );
  const noteCount = useWorkspaceStore((state) => {
    const ws = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
    return ws ? ws.files.filter((entry) => entry.relativePath.toLowerCase().endsWith(".md")).length : 0;
  });

  // Stable callbacks so FileTree's memo can short-circuit on
  // workspace store ticks that don't actually shift the file list
  // (chat tokens, autosaves, fs events).
  const handleRename = useCallback(
    async (relativePath: string) => {
      await selectFile(relativePath);
      const target = await requestRename(relativePath);
      if (!target || target === relativePath) {
        return;
      }
      await renameActiveFile(target);
    },
    [selectFile, renameActiveFile, requestRename],
  );

  const handleDelete = useCallback(
    async (relativePath: string) => {
      const confirmed = await confirm({
        title: "Delete file",
        message: `Delete ${relativePath}? This cannot be undone.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!confirmed) {
        return;
      }
      await selectFile(relativePath);
      await deleteActiveFile();
    },
    [selectFile, deleteActiveFile, confirm],
  );

  // FileTree's callbacks pass through to store actions. The wrapping arrows
  // would be new references every render — useCallback keeps FilesTab's (and
  // FileTree's) memo stable so the file list doesn't re-render on store ticks.
  const handleSelectFile = useCallback(
    (relativePath: string) => void selectFile(relativePath),
    [selectFile],
  );
  const handleDeleteAdapter = useCallback(
    (relativePath: string) => void handleDelete(relativePath),
    [handleDelete],
  );
  const handleRenameAdapter = useCallback(
    (relativePath: string) => void handleRename(relativePath),
    [handleRename],
  );
  // Moving a file into a folder is a rename into that folder — which already
  // carries the open tab, chat context, comments, and version history along
  // (renameActiveFile). selectFile makes the dragged file the active target.
  const handleMoveFile = useCallback(
    (from: string, folderPath: string) => {
      const slash = from.lastIndexOf("/");
      const base = slash >= 0 ? from.slice(slash + 1) : from;
      const dest = folderPath ? `${folderPath}/${base}` : base;
      if (dest === from) {
        return;
      }
      void (async () => {
        await selectFile(from);
        await renameActiveFile(dest);
      })();
    },
    [selectFile, renameActiveFile],
  );

  // One context-aware "New" button: a note on the Notes tab, a chat on the
  // Chat tab.
  const newLabel = sidebarTab === "files" ? "New note" : "New chat";
  const onNew = sidebarTab === "files" ? createNote : newChat;

  // A header-level "New folder" so the first/top-level folder can be created
  // even in an empty workspace (the tree's "New folder here" needs an existing
  // folder row). Lands in the selected folder (newNoteDir) or the root (#56).
  const handleNewFolder = useCallback(() => {
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
      await createFolder(newNoteDir ? `${newNoteDir}/${trimmed}` : trimmed);
    })();
  }, [promptText, createFolder, newNoteDir]);

  if (sidebarCollapsed) {
    return null;
  }

  return (
    <aside className="sidebar">
      <div
        className="sidebar-titlebar"
        // The row is the macOS title-bar drag zone. We wire `mousedown` to
        // Tauri's `window.startDragging()` rather than relying solely on
        // `data-tauri-drag-region`, which is flaky in WKWebView + Overlay
        // title-bar style. The button below is interactive — `useWindowDrag`
        // ignores clicks on `<button>` so it won't be hijacked.
        data-tauri-drag-region
        onMouseDown={onTitlebarMouseDown}
        style={{ ["--traffic-lights-inset" as never]: `${MAC_TRAFFIC_LIGHTS_INSET}px` }}
      >
        <button
          type="button"
          className="sidebar-titlebar__btn"
          data-tauri-drag-region="false"
          onClick={() => toggleSidebar()}
          aria-label="Collapse sidebar"
          title="Collapse sidebar"
        >
          <PanelLeft size={16} aria-hidden />
        </button>
      </div>

      <WorkspaceMenu />

      <div className="sidebar-tabs" role="tablist" aria-label="Sidebar">
        <button
          type="button"
          role="tab"
          aria-selected={sidebarTab === "files"}
          className={[
            "sidebar-tab",
            sidebarTab === "files" ? "sidebar-tab--active" : "",
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
            "sidebar-tab",
            sidebarTab === "chat" ? "sidebar-tab--active" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setSidebarTab("chat")}
        >
          Chat
        </button>
        <button
          type="button"
          className="sidebar-new"
          onClick={() => void onNew()}
          disabled={!hasWorkspace}
          aria-label={newLabel}
          title={newLabel}
        >
          <AddAlt size={16} />
          <span>{newLabel}</span>
        </button>
        {sidebarTab === "files" ? (
          <button
            type="button"
            className="sidebar-new sidebar-new--icon"
            onClick={handleNewFolder}
            disabled={!hasWorkspace}
            aria-label="New folder"
            title="New folder"
          >
            <FolderAdd size={16} />
          </button>
        ) : null}
      </div>

      {/* Both panes stay mounted; visibility flips via the `hidden` attribute.
          Switching tabs becomes a paint-only toggle — no `parseFrontmatter`
          on a large note, no FileTree rebuild, no SidebarChatList remount. */}
      <div hidden={sidebarTab !== "files"} className="sidebar-pane-wrap">
        <FilesTab
          onSelectFile={handleSelectFile}
          onRenameFile={handleRenameAdapter}
          onDeleteFile={handleDeleteAdapter}
          onMoveFile={handleMoveFile}
        />
      </div>
      <div hidden={sidebarTab !== "chat"} className="sidebar-pane-wrap">
        <div className="sidebar-pane sidebar-pane--chat">
          {hasWorkspace ? (
            <SidebarChatList />
          ) : (
            <div className="sidebar-chat__empty">
              <p>Open a folder to see its conversations.</p>
            </div>
          )}
        </div>
      </div>

      <div className="sidebar-footer">
        <span className="sidebar-footer__count">
          {hasWorkspace ? `${noteCount} note${noteCount === 1 ? "" : "s"}` : "No folder"}
        </span>
        <div className="sidebar-footer__actions">
          <button
            type="button"
            className="sidebar-footer__btn"
            onClick={() => openSearch()}
            disabled={!hasWorkspace}
            aria-label="Search workspace"
            title="Search"
          >
            <Search size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="sidebar-footer__btn"
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
 * The Files tab body: the file tree and the active file's Properties
 * (frontmatter) editor. Search moved to the footer popover — the INDEX section
 * is gone from here.
 */
/**
 * Memoised on FILE-ONLY props (`files`, `activeFilePath`, callbacks) — all
 * stable across content edits and the autosave index rebuild. So a keystroke no
 * longer re-renders the files pane. The unsaved-dot is NOT read here — each row
 * self-subscribes via `FileRowDirtyDot`, so a dirty flip re-renders only that
 * one dot, not this pane or the file tree. The active file's frontmatter
 * renders via its own self-subscribing component (ActiveFileProperties),
 * isolated from the file list.
 */
const FilesTab = memo(function FilesTab({
  onSelectFile,
  onRenameFile,
  onDeleteFile,
  onMoveFile,
}: {
  onSelectFile: (path: string) => void;
  onRenameFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  onMoveFile: (fromPath: string, folderPath: string) => void;
}) {
  // Self-subscribing leaf: the file list and active path are read here via
  // NARROW selectors, so a structural change re-renders this pane WITHOUT
  // re-rendering the sidebar shell. The dirty set is deliberately NOT read here
  // (it flipped this pane on every edit/save) — each row owns its own dot.
  const files = useStableFileList();
  const folders = useFolderList();
  const activeFilePath = useWorkspaceStore((state) => {
    const ws = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
    return ws?.activeFilePath ?? "";
  });
  if (!files) {
    return (
      <div className="sidebar-pane sidebar-pane--files">
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
    <div className="sidebar-pane sidebar-pane--files">
      <div className="sidebar-files">
        <FileTree
          activePath={activeFilePath}
          files={files}
          folders={folders}
          onDelete={onDeleteFile}
          onRename={onRenameFile}
          onMoveFile={onMoveFile}
          onSelectFile={onSelectFile}
        />
      </div>

      <ActiveFileProperties />
    </div>
  );
});

/**
 * The file list with a STABLE reference when the DISPLAYED structure (relative
 * paths, in order) is unchanged. The tree shows only names, so a save's
 * `lastModifiedMs`/`sizeBytes` update on an entry — which creates a fresh
 * `files` array every save — must NOT re-render it. We compare the paths and
 * reuse the previous array reference when they match. Returns null for "no
 * workspace" so FilesTab can show its empty state.
 */
function useStableFileList(): WorkspaceFileEntry[] | null {
  // Subscribe to a paths KEY (a string) so a save's mtime/size churn on an entry
  // — which makes a fresh `files` array every save — doesn't re-render the tree.
  const key = useWorkspaceStore((state) => {
    const ws = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
    return ws ? ws.files.map((entry) => entry.relativePath).join("\n") : null;
  });
  return useMemo(() => {
    if (key === null) return null;
    const state = useWorkspaceStore.getState();
    const ws = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
    return ws?.files ?? null;
  }, [key]);
}

const EMPTY_FOLDERS: string[] = [];

/** The active workspace's folder paths. They change only on a scan or a
 *  create/delete — not on a save — so the stored array reference is already
 *  stable to pass straight to the memoised tree. */
function useFolderList(): string[] {
  return useWorkspaceStore((state) => {
    const ws = state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId);
    return ws?.folders ?? EMPTY_FOLDERS;
  });
}

