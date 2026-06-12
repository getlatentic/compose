import { useCallback, useEffect, useMemo, useState } from "react";
import { InlineNotification } from "@carbon/react";
import { AddAlt, Search, Settings } from "@carbon/react/icons";
import type { BobWorkspace } from "../../app/workspaceModel";
import { useWorkspaceStore } from "../../app/workspaceStore";
import {
  searchWorkspaceIndex,
  type WorkspaceBacklinkRecord,
  type WorkspaceSearchHit,
} from "../../lib/ipc/indexClient";
import { useTextPrompt } from "../dialogs/TextPromptProvider";
import { FileTree } from "../file-tree/FileTree";
import { SidebarChatList } from "../chat/SidebarChatList";
import { PropertiesPanel } from "./PropertiesPanel";
import { WorkspaceMenu } from "./WorkspaceMenu";

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
  const openSettings = useWorkspaceStore((state) => state.openSettings);
  const promptText = useTextPrompt();
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<WorkspaceSearchHit[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "searching">("idle");
  const activeBacklinks = useMemo(() => activeFileBacklinks(activeWorkspace), [activeWorkspace]);
  // The active file's current content. Drives the Properties
  // panel below — we parse frontmatter out of this on every
  // render. Cheap (regex + small YAML), so no memoization needed.
  const activeFileContent = activeWorkspace?.activeFilePath
    ? activeWorkspace.fileContents[activeWorkspace.activeFilePath]?.content ?? null
    : null;

  useEffect(() => {
    const trimmedQuery = searchQuery.trim();
    if (!activeWorkspace || activeWorkspace.indexState !== "ready" || !trimmedQuery) {
      setSearchError(null);
      setSearchResults([]);
      setSearchState("idle");
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setSearchState("searching");
      searchWorkspaceIndex(activeWorkspace.id, trimmedQuery, 8)
        .then((results) => {
          if (!cancelled) {
            setSearchError(null);
            setSearchResults(results);
            setSearchState("idle");
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setSearchError(error instanceof Error ? error.message : "Search failed");
            setSearchResults([]);
            setSearchState("idle");
          }
        });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [
    activeWorkspace?.id,
    activeWorkspace?.indexSnapshot?.indexedAtMs,
    activeWorkspace?.indexState,
    searchQuery,
  ]);

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

  // One context-aware "New" button: a note on the Files tab, a chat on the
  // Chat tab. Replaces the old top-bar "New note" + the in-panel "new chat".
  const newLabel = sidebarTab === "files" ? "New note" : "New chat";
  const onNew = sidebarTab === "files" ? createNote : newChat;

  return (
    <aside className="bob-sidebar">
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
          Files
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
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          searchResults={searchResults}
          searchError={searchError}
          searchState={searchState}
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

      <button
        type="button"
        className="bob-sidebar-settings"
        onClick={() => openSettings()}
      >
        <Settings size={16} />
        <span>Settings</span>
      </button>
    </aside>
  );
}

/**
 * The Files tab body: the file tree, the active file's Properties (frontmatter)
 * editor, and the Index search + backlinks. Pulled out of the sidebar shell so
 * the tab switch is a single clean swap and each tab owns its own concern.
 */
function FilesTab({
  activeWorkspace,
  onSelectFile,
  onRenameFile,
  onDeleteFile,
  activeFileContent,
  onUpdateContent,
  searchQuery,
  onSearchQueryChange,
  searchResults,
  searchError,
  searchState,
  backlinks,
}: {
  activeWorkspace: BobWorkspace | null;
  onSelectFile: (path: string) => void;
  onRenameFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  activeFileContent: string | null;
  onUpdateContent: (next: string) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  searchResults: WorkspaceSearchHit[];
  searchError: string | null;
  searchState: "idle" | "searching";
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

      <div className="bob-sidebar-index">
        <div className="bob-section-label">
          <span>Index</span>
          <span className="bob-section-meta">{indexStatusText(activeWorkspace)}</span>
        </div>
        <label className="bob-search-field">
          <Search size={16} />
          <input
            aria-label="Search workspace"
            disabled={activeWorkspace.indexState !== "ready"}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search files"
            value={searchQuery}
          />
        </label>
        <SearchResults
          onSelectFile={onSelectFile}
          query={searchQuery}
          results={searchResults}
          searchError={searchError}
          searchState={searchState}
        />
        <BacklinksList backlinks={backlinks} onSelectFile={onSelectFile} />
      </div>
    </div>
  );
}

function SearchResults({
  onSelectFile,
  query,
  results,
  searchError,
  searchState,
}: {
  onSelectFile: (path: string) => void;
  query: string;
  results: WorkspaceSearchHit[];
  searchError: string | null;
  searchState: "idle" | "searching";
}) {
  const trimmedQuery = query.trim();
  if (searchError) {
    return <p className="bob-index-message">{searchError}</p>;
  }
  if (!trimmedQuery) {
    return null;
  }
  if (searchState === "searching") {
    return <p className="bob-index-message">Searching...</p>;
  }
  if (results.length === 0) {
    return <p className="bob-index-message">No matches</p>;
  }

  return (
    <div className="bob-search-results" aria-label="Search results">
      {results.map((result) => (
        <button
          type="button"
          key={`${result.docId}:${result.ranges[0]?.start ?? 0}`}
          className="bob-search-result"
          onClick={() => onSelectFile(result.path)}
        >
          <span className="bob-search-result__title">{result.title}</span>
          <span className="bob-search-result__path">{result.path}</span>
          <span className="bob-search-result__snippet">{result.snippet}</span>
        </button>
      ))}
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
  if (backlinks.length === 0) {
    return null;
  }

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

function indexStatusText(workspace: BobWorkspace) {
  if (workspace.indexState === "indexing") {
    return "Indexing";
  }
  if (workspace.indexState === "failed") {
    return "Failed";
  }
  if (workspace.indexState === "ready") {
    return `${workspace.indexSnapshot?.indexedDocumentCount ?? 0} docs`;
  }
  return "Idle";
}
