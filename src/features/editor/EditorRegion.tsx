import { useCallback, useEffect, useMemo } from "react";
import { PaneTabs, type EditorTab } from "./PaneTabs";
import { ActiveDocument } from "./ActiveDocument";
import { DocumentStatusBar } from "./DocumentStatusBar";
import { WorkspaceWelcome } from "../workspace/WorkspaceWelcome";
import { MAC_TRAFFIC_LIGHTS_INSET } from "../workspace/WorkspaceSidebar";
import { useWorkspaceStore } from "../../app/workspaceStore";
import { useUiStore } from "../../app/store/uiStore";
import { selectActiveWorkspace } from "../../app/store/activeWorkspace";
import { markBoot } from "../../lib/perf";

/**
 * The editor region — a LAYOUT SHELL: the tab strip, the editor body (which
 * file state to show), and the status bar. It subscribes only to STRUCTURAL
 * facts (which file is open, whether it exists, how many files the workspace
 * has) — never the active file's content — so a keystroke re-renders the leaves
 * that own content ({@link ActiveDocument}, {@link DocumentStatusBar}) and not
 * this shell, the tabs, the sidebar, or chat. Rendered by AppShell only when
 * `editorOpen`.
 */
export function EditorRegion() {
  useEffect(() => {
    markBoot("editor");
  }, []);
  const activeFilePath = useWorkspaceStore(
    (state) => selectActiveWorkspace(state)?.activeFilePath ?? "",
  );
  // Whether the active file is present in the scanned file list (vs still
  // loading its buffer, vs no file open). A boolean — stable across a save's
  // mtime/size churn on the entry.
  const activeFileExists = useWorkspaceStore((state) => {
    const workspace = selectActiveWorkspace(state);
    const path = workspace?.activeFilePath;
    return Boolean(path && workspace!.files.some((entry) => entry.relativePath === path));
  });
  const fileCount = useWorkspaceStore((state) => selectActiveWorkspace(state)?.files.length ?? 0);
  // Open paths as a string KEY — stable across edits/saves so the memoised
  // PaneTabs re-renders only when a tab opens/closes (dirty is read per-tab by
  // TabDirtyDot).
  const openTabsKey = useWorkspaceStore(
    (state) => selectActiveWorkspace(state)?.openFilePaths.join("\n") ?? "",
  );

  const closeFileTab = useWorkspaceStore((state) => state.closeFileTab);
  const createNote = useWorkspaceStore((state) => state.createNote);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const chatOpen = useUiStore((state) => state.chatOpen);
  const toggleChat = useUiStore((state) => state.toggleChat);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const requestComposerFocus = useUiStore((state) => state.requestComposerFocus);

  const openTabs = useMemo<EditorTab[]>(() => {
    const ws = useWorkspaceStore.getState().activeWorkspace();
    if (!ws) return [];
    const tabs: EditorTab[] = [];
    for (const filePath of ws.openFilePaths) {
      const entry = ws.files.find((file) => file.relativePath === filePath);
      if (!entry) continue;
      tabs.push({ entry });
    }
    return tabs;
    // openTabsKey captures the open paths; getState reads the live entries when
    // those change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTabsKey]);

  // Stable so the memoised PaneTabs isn't re-rendered by a fresh callback
  // identity on every render.
  const handleSelectTab = useCallback((path: string) => void selectFile(path), [selectFile]);
  const handleCloseTab = useCallback(
    (filePath: string) => {
      const workspace = useWorkspaceStore.getState().activeWorkspace();
      const buffer = workspace?.fileContents[filePath];
      if (buffer?.dirty) {
        const confirmed = window.confirm(
          `${filePath} has unsaved changes. Close the tab without saving?`,
        );
        if (!confirmed) {
          return;
        }
      }
      closeFileTab(filePath);
    },
    [closeFileTab],
  );

  return (
    <main id="main-content" className="editor-region">
      <PaneTabs
        files={openTabs}
        activeFilePath={activeFilePath}
        onSelectFile={handleSelectTab}
        onCloseFile={handleCloseTab}
        leadingInsetPx={sidebarCollapsed ? MAC_TRAFFIC_LIGHTS_INSET : 0}
        onShowSidebar={sidebarCollapsed ? toggleSidebar : undefined}
      />
      {activeFileExists ? (
        <ActiveDocument />
      ) : fileCount === 0 ? (
        <div className="editor-body">
          <WorkspaceWelcome
            onNewNote={() => void createNote()}
            onAskAssistant={() => {
              if (!chatOpen) toggleChat();
              requestComposerFocus();
            }}
          />
        </div>
      ) : (
        <div className="editor-body">
          <div className="empty-state">
            <div>
              <p className="empty-state__title">No file open</p>
              <p>Choose a Markdown file from the workspace sidebar.</p>
            </div>
          </div>
        </div>
      )}
      <DocumentStatusBar />
    </main>
  );
}
