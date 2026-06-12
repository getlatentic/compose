import { useCallback, useEffect, useMemo, useState } from "react";
import { InlineNotification } from "@carbon/react";
import { AddAlt, Close, FolderAdd, Search } from "@carbon/react/icons";
import type { BobWorkspace } from "../../app/workspaceModel";
import { useWorkspaceStore } from "../../app/workspaceStore";
import {
  searchWorkspaceIndex,
  type WorkspaceBacklinkRecord,
  type WorkspaceSearchHit,
} from "../../lib/ipc/indexClient";
import {
  addWorkspace,
  canUseNativeFolderPicker,
  removeWorkspace,
  selectWorkspaceFolder,
  switchWorkspace,
} from "../../lib/ipc/workspaceClient";
import {
  applyImportedFolder,
  importFolderFromPicker,
  type ImportedFile,
} from "../../lib/workspace/folderImport";
import { useTextPrompt } from "../dialogs/TextPromptProvider";
import { FileTree } from "../file-tree/FileTree";
import { PropertiesPanel } from "./PropertiesPanel";

export function WorkspaceSidebar() {
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const createNote = useWorkspaceStore((state) => state.createNote);
  const deleteActiveFile = useWorkspaceStore((state) => state.deleteActiveFile);
  const hydrateWorkspaces = useWorkspaceStore((state) => state.hydrateWorkspaces);
  const renameActiveFile = useWorkspaceStore((state) => state.renameActiveFile);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const switchLocalWorkspace = useWorkspaceStore((state) => state.switchWorkspace);
  const updateActiveContent = useWorkspaceStore((state) => state.updateActiveContent);
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const promptText = useTextPrompt();
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
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

  async function handleSwitch(workspaceId: string) {
    setErrorMessage(null);
    switchLocalWorkspace(workspaceId);

    try {
      const workspaceList = await switchWorkspace(workspaceId);
      hydrateWorkspaces(workspaceList);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Workspace could not be switched");
    }
  }

  async function handleRemove(workspaceId: string) {
    setErrorMessage(null);

    try {
      const workspaceList = await removeWorkspace(workspaceId);
      hydrateWorkspaces(workspaceList);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Workspace could not be removed");
    }
  }

  async function handleChooseFolder() {
    setErrorMessage(null);
    setNoticeMessage(null);

    if (canUseNativeFolderPicker()) {
      const selectedPath = await selectWorkspaceFolder();
      if (!selectedPath) {
        return;
      }
      await openWorkspacePath(selectedPath);
      return;
    }

    // Browser: copy a real folder into the persisted virtual workspace.
    const imported = await importFolderFromPicker();
    if (!imported) {
      return;
    }
    if (imported.files.length === 0) {
      setNoticeMessage("No Markdown files were found in that folder.");
      return;
    }
    await openWorkspacePath(`/${imported.folderName}`, imported.files);
  }

  async function openWorkspacePath(workspacePath: string, importedFiles?: ImportedFile[]) {
    setErrorMessage(null);
    setNoticeMessage(null);

    try {
      const workspaceList = await addWorkspace(workspacePath);
      if (importedFiles && workspaceList.activeWorkspaceId) {
        // Populate the virtual workspace before hydrate activates it, so the
        // scan AppShell triggers reads the imported files.
        await applyImportedFolder(workspaceList.activeWorkspaceId, importedFiles);
      }
      hydrateWorkspaces(workspaceList);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Workspace could not be added");
    }
  }

  return (
    <aside className="bob-sidebar">
      <div className="bob-sidebar-section">
        <div className="bob-section-label">
          <span>Workspaces</span>
          <button
            type="button"
            className="bob-icon-button"
            onClick={() => void handleChooseFolder()}
            aria-label="Open folder"
            title="Open folder"
          >
            <FolderAdd size={16} />
          </button>
        </div>
        <div className="bob-workspace-list">
          {workspaces.map((workspace) => {
            const active = workspace.id === activeWorkspaceId;
            return (
              <div key={workspace.id} className="bob-workspace-item">
                <button
                  type="button"
                  onClick={() => void handleSwitch(workspace.id)}
                  className={["bob-workspace-button", active ? "bob-workspace-button--active" : ""]
                    .filter(Boolean)
                    .join(" ")}
                  title={workspace.path}
                >
                  <span className="truncate">{workspace.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleRemove(workspace.id)}
                  aria-label={`Remove ${workspace.name}`}
                  title={`Remove ${workspace.name}`}
                  className="bob-icon-button bob-icon-button--quiet"
                >
                  <Close size={14} />
                </button>
              </div>
            );
          })}
        </div>
        {noticeMessage ? (
          <InlineNotification
            hideCloseButton
            kind="info"
            lowContrast
            subtitle={noticeMessage}
            title="Browser preview"
          />
        ) : null}
        {errorMessage ? (
          <InlineNotification
            hideCloseButton
            kind="error"
            lowContrast
            subtitle={errorMessage}
            title="Workspace failed"
          />
        ) : null}
      </div>

      <div className="bob-sidebar-files">
        <div className="bob-section-label">
          <span>Files</span>
          <button
            type="button"
            className="bob-icon-button"
            onClick={() => void createNote()}
            aria-label="New note"
            title="New note"
            disabled={!activeWorkspace}
          >
            <AddAlt size={16} />
          </button>
        </div>
        {activeWorkspace ? (
          <FileTree
            activePath={activeWorkspace.activeFilePath}
            fileContents={activeWorkspace.fileContents}
            files={activeWorkspace.files}
            onDelete={handleDeleteAdapter}
            onRename={handleRenameAdapter}
            onSelectFile={handleSelectFile}
          />
        ) : null}
      </div>

      {activeFileContent !== null ? (
        <PropertiesPanel
          markdown={activeFileContent}
          onChange={handleUpdateContent}
        />
      ) : null}

      {activeWorkspace ? (
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
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search files"
              value={searchQuery}
            />
          </label>
          <SearchResults
            onSelectFile={(path) => void selectFile(path)}
            query={searchQuery}
            results={searchResults}
            searchError={searchError}
            searchState={searchState}
          />
          <BacklinksList
            backlinks={activeBacklinks}
            onSelectFile={(path) => void selectFile(path)}
          />
        </div>
      ) : null}

    </aside>
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
